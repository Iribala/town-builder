package cursor

import (
	"github.com/duber000/town-builder/internal/routes/common"
	"github.com/duber000/town-builder/internal/services/town_helpers"
	httphelper "github.com/kukichalang/kukicha/stdlib/http"
	"net/http"
)

func readPosition(raw any) map[string]any {
	out := map[string]any{"x": 0.0, "y": 0.0, "z": 0.0}
	m, ok := raw.(map[string]any)
	if !ok {
		return out
	}
	for _, key := range []string{"x", "y", "z"} {
		if v, vok := m[key]; vok {
			if f, fok := v.(float64); fok {
				out[key] = f
			}
		}
	}
	return out
}

func update(w http.ResponseWriter, r *http.Request) {
	u, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	body := make(map[string]any)
	err := httphelper.ReadJSON(r, &body)
	if err != nil {
		httphelper.JSONBadRequest(w, "Invalid JSON body")
		return
	}
	pos := readPosition(body["position"])
	cam := readPosition(body["camera_position"])
	event := map[string]any{"type": "cursor", "username": u.Username, "position": pos, "camera_position": cam}
	town_helpers.BroadcastSSE(event)
	httphelper.JSON(w, map[string]any{"status": "success", "message": "Cursor position updated"})
}

func Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/cursor/update", update)
}
