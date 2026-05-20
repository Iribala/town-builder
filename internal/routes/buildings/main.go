package buildings

import (
	"fmt"
	"github.com/duber000/town-builder/internal/normalization"
	"github.com/duber000/town-builder/internal/routes/common"
	"github.com/duber000/town-builder/internal/services/town_helpers"
	"github.com/duber000/town-builder/internal/storage"
	"github.com/kukichalang/kukicha/stdlib/crypto"
	httphelper "github.com/kukichalang/kukicha/stdlib/http"
	"github.com/kukichalang/kukicha/stdlib/log"
	"net/http"
)

func optMap(m map[string]any, key string) (map[string]any, bool) {
	if v, ok := m[key]; ok && (v != nil) {
		if mm, mok := v.(map[string]any); mok {
			return mm, true
		}
	}
	return nil, false
}

func optString(m map[string]any, key string) string {
	if v, ok := m[key]; ok {
		if s, sok := v.(string); sok {
			return s
		}
	}
	return ""
}

func vec3(x float64, y float64, z float64) map[string]any {
	return map[string]any{"x": x, "y": y, "z": z}
}

func defaultRotation() map[string]any {
	return vec3(0.0, 0.0, 0.0)
}

func defaultScale() map[string]any {
	return vec3(1.0, 1.0, 1.0)
}

func response(building map[string]any, category string) map[string]any {
	pos, _ := optMap(building, "position")
	if pos == nil {
		pos = defaultRotation()
	}
	rot, _ := optMap(building, "rotation")
	if rot == nil {
		rot = defaultRotation()
	}
	scl, _ := optMap(building, "scale")
	if scl == nil {
		scl = defaultScale()
	}
	out := map[string]any{"id": optString(building, "id"), "model": optString(building, "model"), "category": category, "position": pos, "rotation": rot, "scale": scl}
	if drv, ok := building["driver"]; ok {
		out["driver"] = drv
	}
	return out
}

func findBuilding(townData map[string]any, buildingID string) (string, map[string]any, int) {
	for _, category := range normalization.Categories {
		v, ok := townData[category]
		if !ok {
			continue
		}
		arr, aok := v.([]any)
		if !aok {
			continue
		}
		for i := range len(arr) {
			entry, eok := arr[i].(map[string]any)
			if !eok {
				continue
			}
			if optString(entry, "id") == buildingID {
				return category, entry, i
			}
		}
	}
	return "", nil, -1
}

func newID() string {
	raw, err := crypto.RandomToken(8)
	if err != nil {
		return "obj_00000000"
	}
	return ("obj_" + raw[:8])
}

func categoryList(townData map[string]any, category string) []any {
	if v, ok := townData[category]; ok {
		if arr, aok := v.([]any); aok {
			return arr
		}
	}
	return []any{}
}

func setCategory(townData map[string]any, category string, arr []any) {
	townData[category] = arr
}

func create(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	body := make(map[string]any)
	err := httphelper.ReadJSON(r, &body)
	if err != nil {
		httphelper.JSONBadRequest(w, "Invalid JSON body")
		return
	}
	model := optString(body, "model")
	if model == "" {
		httphelper.JSONBadRequest(w, "model is required")
		return
	}
	category := optString(body, "category")
	if category == "" {
		category = "buildings"
	}
	pos, pok := optMap(body, "position")
	if !pok {
		httphelper.JSONBadRequest(w, "position is required")
		return
	}
	rot, _ := optMap(body, "rotation")
	if rot == nil {
		rot = defaultRotation()
	}
	scl, _ := optMap(body, "scale")
	if scl == nil {
		scl = defaultScale()
	}
	buildingID := newID()
	building := map[string]any{"id": buildingID, "model": model, "position": pos, "rotation": rot, "scale": scl}
	townData, gerr := storage.Get()
	if gerr != nil {
		httphelper.JSONError(w, "Failed to load town data", 500)
		return
	}
	arr := categoryList(townData, category)
	arr = append(arr, any(building))
	setCategory(townData, category, arr)
	err = town_helpers.SaveAndBroadcast(townData, map[string]any{"type": "full", "town": townData})
	if err != nil {
		httphelper.JSONError(w, "Failed to save", 500)
		return
	}
	log.Info(fmt.Sprintf("Created building: %v (%v) in category %v", buildingID, model, category))
	httphelper.JSONStatus(w, response(building, category), 201)
}

func list(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	townData, err := storage.Get()
	if err != nil {
		httphelper.JSONError(w, "Failed to load town data", 500)
		return
	}
	cat := r.URL.Query().Get("category")
	cats := normalization.Categories
	if cat != "" {
		cats = []string{cat}
	}
	out := []map[string]any{}
	for _, c := range cats {
		v, vok := townData[c]
		if !vok {
			continue
		}
		arr, aok := v.([]any)
		if !aok {
			continue
		}
		for _, item := range arr {
			if mm, mok := item.(map[string]any); mok {
				out = append(out, response(mm, c))
			}
		}
	}
	log.Info(fmt.Sprintf("Listed %v buildings", len(out)))
	httphelper.JSON(w, out)
}

func get(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	townData, err := storage.Get()
	if err != nil {
		httphelper.JSONError(w, "Failed to load town data", 500)
		return
	}
	cat, b, _ := findBuilding(townData, id)
	if b == nil {
		httphelper.JSONNotFound(w, fmt.Sprintf("Building with ID %v not found", id))
		return
	}
	httphelper.JSON(w, response(b, cat))
}

func update(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	body := make(map[string]any)
	err := httphelper.ReadJSON(r, &body)
	if err != nil {
		httphelper.JSONBadRequest(w, "Invalid JSON body")
		return
	}
	townData, gerr := storage.Get()
	if gerr != nil {
		httphelper.JSONError(w, "Failed to load town data", 500)
		return
	}
	cat, b, idx := findBuilding(townData, id)
	if b == nil {
		httphelper.JSONNotFound(w, fmt.Sprintf("Building with ID %v not found", id))
		return
	}
	arr := categoryList(townData, cat)
	current, _ := arr[idx].(map[string]any)
	if pos, pok := optMap(body, "position"); pok {
		current["position"] = pos
	}
	if rot, rok := optMap(body, "rotation"); rok {
		current["rotation"] = rot
	}
	if scl, sok := optMap(body, "scale"); sok {
		current["scale"] = scl
	}
	if m := optString(body, "model"); m != "" {
		current["model"] = m
	}
	newCat := optString(body, "category")
	if (newCat != "") && (newCat != cat) {
		newArr := []any{}
		for i := range len(arr) {
			if i != idx {
				newArr = append(newArr, arr[i])
			}
		}
		setCategory(townData, cat, newArr)
		destArr := categoryList(townData, newCat)
		destArr = append(destArr, any(current))
		setCategory(townData, newCat, destArr)
		cat = newCat
	} else {
		arr[idx] = current
		setCategory(townData, cat, arr)
	}
	err = town_helpers.SaveAndBroadcast(townData, map[string]any{"type": "edit", "category": cat, "id": id, "data": current})
	if err != nil {
		httphelper.JSONError(w, "Failed to save", 500)
		return
	}
	log.Info(fmt.Sprintf("Updated building: %v", id))
	httphelper.JSON(w, response(current, cat))
}

func remove(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	townData, err := storage.Get()
	if err != nil {
		httphelper.JSONError(w, "Failed to load town data", 500)
		return
	}
	cat, _, idx := findBuilding(townData, id)
	if idx == -1 {
		httphelper.JSONNotFound(w, fmt.Sprintf("Building with ID %v not found", id))
		return
	}
	arr := categoryList(townData, cat)
	newArr := []any{}
	for i := range len(arr) {
		if i != idx {
			newArr = append(newArr, arr[i])
		}
	}
	setCategory(townData, cat, newArr)
	serr := town_helpers.SaveAndBroadcast(townData, map[string]any{"type": "delete", "category": cat, "id": id})
	if serr != nil {
		httphelper.JSONError(w, "Failed to save", 500)
		return
	}
	log.Info(fmt.Sprintf("Deleted building: %v from category %v", id, cat))
	httphelper.JSON(w, map[string]any{"status": "success", "message": fmt.Sprintf("Building %v deleted successfully", id)})
}

func Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/buildings", create)
	mux.HandleFunc("GET /api/buildings", list)
	mux.HandleFunc("GET /api/buildings/{id}", get)
	mux.HandleFunc("PUT /api/buildings/{id}", update)
	mux.HandleFunc("DELETE /api/buildings/{id}", remove)
}
