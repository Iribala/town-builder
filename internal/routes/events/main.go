package events

import (
	"fmt"
	"github.com/duber000/town-builder/internal/config"
	"github.com/duber000/town-builder/internal/pubsub"
	"github.com/duber000/town-builder/internal/services/auth"
	"github.com/duber000/town-builder/internal/services/town_helpers"
	"github.com/duber000/town-builder/internal/storage"
	httphelper "github.com/kukichalang/kukicha/stdlib/http"
	"github.com/kukichalang/kukicha/stdlib/json"
	"github.com/kukichalang/kukicha/stdlib/log"
	"net/http"
	"time"
)

func writeEvent(w http.ResponseWriter, flusher http.Flusher, payload []byte) bool {
	_, err := w.Write([]byte("data: "))
	if err != nil {
		return false
	}
	_, err = w.Write(payload)
	if err != nil {
		return false
	}
	_, err = w.Write([]byte("\n\n"))
	if err != nil {
		return false
	}
	flusher.Flush()
	return true
}

func writeRaw(w http.ResponseWriter, flusher http.Flusher, raw string) bool {
	_, err := w.Write([]byte(raw))
	if err != nil {
		return false
	}
	flusher.Flush()
	return true
}

func writeEventMap(w http.ResponseWriter, flusher http.Flusher, event map[string]any) bool {
	payload, err := json.Bytes(event)
	if err != nil {
		log.Warn(fmt.Sprintf("Failed to encode SSE event: %v", err))
		return true
	}
	return writeEvent(w, flusher, payload)
}

func broadcastUsers() {
	town_helpers.BroadcastSSE(map[string]any{"type": "users", "users": pubsub.OnlineUsers()})
}

func sse(w http.ResponseWriter, r *http.Request) {
	s := config.Current()
	if (s != nil) && !s.DisableJwtAuth {
		cookie, err := r.Cookie("auth_token")
		if ((err != nil) || (cookie == nil)) || (cookie.Value == "") {
			httphelper.JSONUnauthorized(w, "Not authenticated")
			return
		}
		_, verr := auth.VerifyTokenString(cookie.Value)
		if verr != nil {
			httphelper.JSONUnauthorized(w, "Not authenticated")
			return
		}
	}
	playerName := r.URL.Query().Get("name")
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		httphelper.JSONError(w, "streaming unsupported", 500)
		return
	}
	if (playerName != "") && !pubsub.CanConnect(playerName) {
		writeEventMap(w, flusher, map[string]any{"type": "error", "message": "Connection limit reached"})
		return
	}
	defer pubsub.Disconnect(playerName)
	if playerName != "" {
		broadcastUsers()
	}
	townData, terr := storage.Get()
	if terr == nil {
		writeEventMap(w, flusher, map[string]any{"type": "full", "town": townData})
	}
	writeEventMap(w, flusher, map[string]any{"type": "users", "users": pubsub.OnlineUsers()})
	msgs, cancelSub := pubsub.Subscribe()
	if cancelSub != nil {
		defer cancelSub()
		log.Info(fmt.Sprintf("SSE client subscribed to pubsub: %v", playerName))
	} else {
		log.Warn("Redis unavailable for SSE; running in keepalive-only mode")
	}
	keepaliveInterval := 10.0
	if s != nil {
		keepaliveInterval = s.SseKeepaliveInterval
	}
	ticker := time.NewTicker(time.Duration(int64((keepaliveInterval * 1_000_000_000.0))))
	defer ticker.Stop()
	ctxDone := r.Context().Done()
	for {
		select {
		case <-ctxDone:
			log.Info(fmt.Sprintf("SSE client disconnected: %v", playerName))
			if playerName != "" {
				broadcastUsers()
			}
			return
		case payload := <-msgs:
			if !writeRaw(w, flusher, fmt.Sprintf("data: %v\n\n", payload)) {
				return
			}
			pubsub.Touch(playerName)
		case <-ticker.C:
			pubsub.Touch(playerName)
			if playerName != "" {
				broadcastUsers()
			}
			if !writeRaw(w, flusher, ": keepalive\n\n") {
				return
			}
		}
	}
}

func Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /events", sse)
}
