package query

import (
	"github.com/duber000/town-builder/internal/routes/common"
	querysvc "github.com/duber000/town-builder/internal/services/query"
	httphelper "github.com/kukichalang/kukicha/stdlib/http"
	"net/http"
)

func readBody(r *http.Request) (map[string]any, bool) {
	body := make(map[string]any)
	err := httphelper.ReadJSON(r, &body)
	if err != nil {
		return nil, false
	}
	return body, true
}

func optMap(m map[string]any, key string) map[string]any {
	if v, ok := m[key]; ok {
		if mm, mok := v.(map[string]any); mok {
			return mm
		}
	}
	return nil
}

func optFloat(m map[string]any, key string, def float64) float64 {
	if v, ok := m[key]; ok {
		if f, fok := v.(float64); fok {
			return f
		}
	}
	return def
}

func optString(m map[string]any, key string) string {
	if v, ok := m[key]; ok {
		if s, sok := v.(string); sok {
			return s
		}
	}
	return ""
}

func optInt(m map[string]any, key string, def int) int {
	if v, ok := m[key]; ok {
		if f, fok := v.(float64); fok {
			return int(f)
		}
	}
	return def
}

func writeResults(w http.ResponseWriter, results []map[string]any) {
	httphelper.JSON(w, map[string]any{"status": "success", "count": len(results), "results": results})
}

func radius(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	body, bok := readBody(r)
	if !bok {
		httphelper.JSONBadRequest(w, "Invalid JSON body")
		return
	}
	results := querysvc.SpatialQueryRadius(optMap(body, "center"), optFloat(body, "radius", 0.0), optString(body, "category"), optInt(body, "limit", 0))
	writeResults(w, results)
}

func bounds(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	body, bok := readBody(r)
	if !bok {
		httphelper.JSONBadRequest(w, "Invalid JSON body")
		return
	}
	results := querysvc.SpatialQueryBounds(optMap(body, "min"), optMap(body, "max"), optString(body, "category"), optInt(body, "limit", 0))
	writeResults(w, results)
}

func nearest(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	body, bok := readBody(r)
	if !bok {
		httphelper.JSONBadRequest(w, "Invalid JSON body")
		return
	}
	hasMaxDist := false
	maxDist := 0.0
	if v, vok := body["max_distance"]; vok && (v != nil) {
		if f, fok := v.(float64); fok {
			hasMaxDist = true
			maxDist = f
		}
	}
	results := querysvc.SpatialQueryNearest(optMap(body, "point"), optString(body, "category"), optInt(body, "count", 1), maxDist, hasMaxDist)
	writeResults(w, results)
}

func advanced(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	body, bok := readBody(r)
	if !bok {
		httphelper.JSONBadRequest(w, "Invalid JSON body")
		return
	}
	filters := []map[string]any{}
	if v, vok := body["filters"]; vok {
		if arr, aok := v.([]any); aok {
			for _, item := range arr {
				if mm, mok := item.(map[string]any); mok {
					filters = append(filters, mm)
				}
			}
		}
	}
	sortOrder := optString(body, "sort_order")
	if sortOrder == "" {
		sortOrder = "asc"
	}
	results := querysvc.AdvancedQuery(optString(body, "category"), filters, optString(body, "sort_by"), sortOrder, optInt(body, "limit", 0), optInt(body, "offset", 0))
	writeResults(w, results)
}

func Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/query/spatial/radius", radius)
	mux.HandleFunc("POST /api/query/spatial/bounds", bounds)
	mux.HandleFunc("POST /api/query/spatial/nearest", nearest)
	mux.HandleFunc("POST /api/query/advanced", advanced)
}
