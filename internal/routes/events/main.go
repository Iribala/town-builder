package events

import (
	"github.com/duber000/town-builder/internal/config"
	"github.com/duber000/town-builder/internal/services/auth"
	httphelper "github.com/kukichalang/kukicha/stdlib/http"
	"net/http"
)

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
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		httphelper.JSONError(w, "streaming unsupported", 500)
		return
	}
	w.Write([]byte(": connected\n\n"))
	flusher.Flush()
	<-r.Context().Done()
}

func Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /events", sse)
}
