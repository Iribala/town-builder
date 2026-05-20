package scene

import (
	"fmt"
	"github.com/duber000/town-builder/internal/normalization"
	"github.com/duber000/town-builder/internal/routes/common"
	"github.com/duber000/town-builder/internal/services/scene_description"
	"github.com/duber000/town-builder/internal/storage"
	httphelper "github.com/kukichalang/kukicha/stdlib/http"
	"github.com/kukichalang/kukicha/stdlib/log"
	"net/http"
)

func description(w http.ResponseWriter, r *http.Request) {
	u, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	data, err := storage.Get()
	if err != nil {
		httphelper.JSONError(w, "Failed to load town data", 500)
		return
	}
	result := scene_description.GenerateSceneDescription(data)
	log.Info(fmt.Sprintf("Scene description requested by %v", u.Username))
	httphelper.JSON(w, map[string]any{"status": "success", "data": result})
}

func stats(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	data, err := storage.Get()
	if err != nil {
		httphelper.JSONError(w, "Failed to load town data", 500)
		return
	}
	out := make(map[string]any)
	if name, nok := data["townName"]; nok {
		out["town_name"] = name
	} else {
		out["town_name"] = "Unnamed Town"
	}
	total := 0
	for _, cat := range normalization.Categories {
		n := 0
		if v, vok := data[cat]; vok {
			if arr, aok := v.([]any); aok {
				n = len(arr)
			}
		}
		out[cat] = n
		total = (total + n)
	}
	out["total"] = total
	log.Info(fmt.Sprintf("Scene stats requested: %v total objects", total))
	httphelper.JSON(w, map[string]any{"status": "success", "data": out})
}

func Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/scene/description", description)
	mux.HandleFunc("GET /api/scene/stats", stats)
}
