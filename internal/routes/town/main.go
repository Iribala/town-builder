package town

import (
	"fmt"
	"github.com/duber000/town-builder/internal/config"
	"github.com/duber000/town-builder/internal/normalization"
	"github.com/duber000/town-builder/internal/routes/common"
	"github.com/duber000/town-builder/internal/services/django_client"
	"github.com/duber000/town-builder/internal/services/town_helpers"
	"github.com/duber000/town-builder/internal/storage"
	"github.com/duber000/town-builder/internal/utils/geometry"
	"github.com/duber000/town-builder/internal/utils/security"
	httphelper "github.com/kukichalang/kukicha/stdlib/http"
	"github.com/kukichalang/kukicha/stdlib/json"
	"github.com/kukichalang/kukicha/stdlib/log"
	"github.com/kukichalang/kukicha/stdlib/sandbox"
	"net/http"
	"strconv"
	"strings"
)

func optString(m map[string]any, key string) string {
	if v, ok := m[key]; ok {
		if s, sok := v.(string); sok {
			return s
		}
	}
	return ""
}

func optMap(m map[string]any, key string) (map[string]any, bool) {
	if v, ok := m[key]; ok && (v != nil) {
		if mm, mok := v.(map[string]any); mok {
			return mm, true
		}
	}
	return nil, false
}

func hasKey(m map[string]any, key string) bool {
	_, ok := m[key]
	return ok
}

func getTown(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	data, err := storage.Get()
	if err != nil {
		httphelper.JSONError(w, "Failed to load town data", 500)
		return
	}
	httphelper.JSON(w, data)
}

func updateTown(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	data := make(map[string]any)
	err := httphelper.ReadJSON(r, &data)
	if err != nil {
		httphelper.JSONBadRequest(w, "Invalid JSON body")
		return
	}
	townData, gerr := storage.Get()
	if gerr != nil {
		httphelper.JSONError(w, "Failed to load town data", 500)
		return
	}
	if hasKey(data, "townName") && (len(data) == 1) {
		name := optString(data, "townName")
		townData["townName"] = name
		town_helpers.SaveAndBroadcast(townData, map[string]any{"type": "name", "townName": name})
		log.Info(fmt.Sprintf("Updated town name to: %v", name))
		httphelper.JSON(w, map[string]any{"status": "success"})
		return
	}
	if (hasKey(data, "driver") && hasKey(data, "id")) && hasKey(data, "category") {
		category := optString(data, "category")
		modelID := optString(data, "id")
		driver := optString(data, "driver")
		updated := false
		v, vok := townData[category]
		if vok {
			arr, aok := v.([]any)
			if aok {
				for i := range len(arr) {
					entry, eok := arr[i].(map[string]any)
					if !eok {
						continue
					}
					if optString(entry, "id") == modelID {
						entry["driver"] = driver
						arr[i] = entry
						townData[category] = arr
						updated = true
						town_helpers.SaveAndBroadcast(townData, map[string]any{"type": "driver", "category": category, "id": modelID, "driver": driver})
						log.Info(fmt.Sprintf("Updated driver for %v id=%v to %v", category, modelID, driver))
						break
					}
				}
			}
		}
		if !updated {
			httphelper.JSONNotFound(w, "Model not found")
			return
		}
		httphelper.JSON(w, map[string]any{"status": "success"})
		return
	}
	canonical := normalization.Normalize(data)
	town_helpers.SaveAndBroadcast(canonical, map[string]any{"type": "full", "town": canonical})
	httphelper.JSON(w, map[string]any{"status": "success"})
}

func normalizeFilename(name string) string {
	base := strings.TrimSuffix(name, ".json")
	return (base + ".json")
}

func saveTown(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	payload := make(map[string]any)
	err := httphelper.ReadJSON(r, &payload)
	if err != nil {
		httphelper.JSONBadRequest(w, "Invalid JSON payload")
		return
	}
	rawData, hasData := payload["data"]
	if !hasData {
		httphelper.JSONBadRequest(w, "data is required")
		return
	}
	filename := optString(payload, "filename")
	if (filename == "") && !hasKey(payload, "filename") {
		filename = "town_data.json"
	}
	townName := optString(payload, "townName")
	canonical := normalization.Normalize(rawData)
	localMsg := ""
	if filename != "" {
		fn := normalizeFilename(filename)
		s := config.Current()
		dataPath := "./data"
		if s != nil {
			dataPath = s.DataPath
		}
		_, perr := security.SafeFilepath(fn, dataPath, []string{".json"})
		if perr != nil {
			httphelper.JSONBadRequest(w, "Invalid filename")
			return
		}
		box, berr := sandbox.New(dataPath)
		if berr != nil {
			httphelper.JSONError(w, "Failed to open data dir", 500)
			return
		}
		bytes, jerr := json.PrettyBytes(canonical)
		if jerr != nil {
			httphelper.JSONError(w, "Failed to encode town data", 500)
			return
		}
		werr := sandbox.Write(box, bytes, fn)
		if werr != nil {
			httphelper.JSONError(w, "Failed to write file", 500)
			return
		}
		log.Info(fmt.Sprintf("Town saved locally to %v", fn))
		localMsg = fmt.Sprintf("Town saved locally to %v.", fn)
	} else {
		localMsg = "Local save skipped (no filename)."
	}
	town_helpers.SaveAndBroadcast(canonical, map[string]any{"type": "full", "town": canonical})
	djangoMsg := ""
	var townID any
	if v, vok := payload["town_id"]; vok && (v != nil) {
		townID = v
	}
	if townID != nil {
		idInt := 0
		if f, fok := townID.(float64); fok {
			idInt = int(f)
		}
		_, derr := django_client.UpdateTown(idInt, payload, canonical, townName)
		if derr != nil {
			log.Error(fmt.Sprintf("Error updating town in Django: %v", derr))
			djangoMsg = fmt.Sprintf(" Warning: failed to sync to Django backend: %v", derr)
		} else {
			djangoMsg = fmt.Sprintf(" Town updated in Django backend (ID: %v).", idInt)
		}
	} else {
		searchName := townName
		if searchName == "" {
			if m, mok := rawData.(map[string]any); mok {
				searchName = optString(m, "townName")
				if searchName == "" {
					searchName = optString(m, "name")
				}
			}
		}
		if searchName != "" {
			existingID, found, serr := django_client.SearchTownByName(searchName)
			if (serr == nil) && found {
				_, uerr := django_client.UpdateTown(existingID, payload, canonical, townName)
				if uerr != nil {
					djangoMsg = fmt.Sprintf(" Warning: failed to sync to Django backend: %v", uerr)
				} else {
					townID = existingID
					djangoMsg = fmt.Sprintf(" Town updated in Django backend (ID: %v).", existingID)
				}
			} else {
				result, cerr := django_client.CreateTown(payload, canonical, townName)
				if cerr != nil {
					djangoMsg = fmt.Sprintf(" Warning: failed to sync to Django backend: %v", cerr)
				} else {
					if v, vok := result["town_id"]; vok {
						townID = v
					}
					djangoMsg = " Town created in Django backend."
				}
			}
		} else {
			result, cerr := django_client.CreateTown(payload, canonical, townName)
			if cerr != nil {
				djangoMsg = fmt.Sprintf(" Warning: failed to sync to Django backend: %v", cerr)
			} else {
				if v, vok := result["town_id"]; vok {
					townID = v
				}
				djangoMsg = " Town created in Django backend."
			}
		}
	}
	httphelper.JSON(w, map[string]any{"status": "success", "message": fmt.Sprintf("%v%v", localMsg, djangoMsg), "town_id": townID})
}

func loadTown(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	body := make(map[string]any)
	httphelper.ReadJSON(r, &body)
	filename := optString(body, "filename")
	if filename == "" {
		filename = "town_data.json"
	}
	fn := normalizeFilename(filename)
	s := config.Current()
	dataPath := "./data"
	if s != nil {
		dataPath = s.DataPath
	}
	_, perr := security.SafeFilepath(fn, dataPath, []string{".json"})
	if perr != nil {
		httphelper.JSONBadRequest(w, "Invalid filename")
		return
	}
	box, berr := sandbox.New(dataPath)
	if berr != nil {
		httphelper.JSONError(w, "Failed to open data dir", 500)
		return
	}
	if !sandbox.Exists(box, fn) {
		httphelper.JSONNotFound(w, fmt.Sprintf("File %v not found", fn))
		return
	}
	raw, rerr := sandbox.Read(box, fn)
	if rerr != nil {
		httphelper.JSONError(w, "Failed to read file", 500)
		return
	}
	var townData any
	jerr := json.ParseInto(raw, &townData)
	if jerr != nil {
		httphelper.JSONError(w, "Failed to parse town data", 500)
		return
	}
	canonical := normalization.Normalize(townData)
	town_helpers.SaveAndBroadcast(canonical, map[string]any{"type": "full", "town": canonical})
	log.Info(fmt.Sprintf("Town loaded from %v", fn))
	httphelper.JSON(w, map[string]any{"status": "success", "message": fmt.Sprintf("Town loaded from %v", fn), "data": canonical})
}

func loadFromDjango(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	idStr := r.PathValue("id")
	idInt, perr := parseTownID(idStr)
	if perr != nil {
		httphelper.JSONBadRequest(w, "Invalid town id")
		return
	}
	townData, derr := django_client.GetTownByID(idInt)
	if derr != nil {
		httphelper.JSONError(w, fmt.Sprintf("Failed to load town from Django: %v", derr), 500)
		return
	}
	log.Info(fmt.Sprintf("Loaded town %v from Django: %v", idInt, optString(townData, "name")))
	var layoutData any
	if v, vok := townData["layout_data"]; vok {
		layoutData = v
	} else {
		layoutData = []any{}
	}
	canonical := normalization.Normalize(layoutData)
	town_helpers.SaveAndBroadcast(canonical, map[string]any{"type": "full", "town": canonical})
	info := map[string]any{"id": townData["id"], "name": townData["name"], "description": townData["description"], "latitude": townData["latitude"], "longitude": townData["longitude"]}
	if cs, csok := townData["category_statuses"]; csok {
		info["category_statuses"] = cs
	} else {
		info["category_statuses"] = []any{}
	}
	httphelper.JSON(w, map[string]any{"status": "success", "message": fmt.Sprintf("Town '%v' loaded from Django", optString(townData, "name")), "data": canonical, "town_info": info})
}

func parseTownID(s string) (int, error) {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, err
	}
	return n, nil
}

func deleteModel(w http.ResponseWriter, r *http.Request) {
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
	category := optString(body, "category")
	modelID := optString(body, "id")
	pos, hasPos := optMap(body, "position")
	if (category == "") || ((modelID == "") && !hasPos) {
		httphelper.JSONBadRequest(w, "Missing required parameters")
		return
	}
	townData, gerr := storage.Get()
	if gerr != nil {
		httphelper.JSONError(w, "Failed to load town data", 500)
		return
	}
	v, vok := townData[category]
	if !vok {
		httphelper.JSONNotFound(w, "Model not found")
		return
	}
	arr, aok := v.([]any)
	if !aok {
		httphelper.JSONNotFound(w, "Model not found")
		return
	}
	if modelID != "" {
		for i := range len(arr) {
			entry, eok := arr[i].(map[string]any)
			if !eok {
				continue
			}
			if optString(entry, "id") == modelID {
				newArr := []any{}
				for j := range len(arr) {
					if j != i {
						newArr = append(newArr, arr[j])
					}
				}
				townData[category] = newArr
				town_helpers.SaveAndBroadcast(townData, map[string]any{"type": "delete", "category": category, "id": modelID})
				httphelper.JSON(w, map[string]any{"status": "success", "message": fmt.Sprintf("Deleted model with ID %v", modelID)})
				return
			}
		}
		httphelper.JSONNotFound(w, "Model not found")
		return
	}
	closestIdx := -1
	closestDist := 1e308
	for i := range len(arr) {
		entry, eok := arr[i].(map[string]any)
		if !eok {
			continue
		}
		mp, _ := optMap(entry, "position")
		d := geometry.CalculateDistance(pos, mp)
		if d < closestDist {
			closestDist = d
			closestIdx = i
		}
	}
	if (closestIdx >= 0) && (closestDist < geometry.DeleteProximityThreshold) {
		deleted, _ := arr[closestIdx].(map[string]any)
		newArr := []any{}
		for j := range len(arr) {
			if j != closestIdx {
				newArr = append(newArr, arr[j])
			}
		}
		townData[category] = newArr
		town_helpers.SaveAndBroadcast(townData, map[string]any{"type": "delete", "category": category, "position": pos, "deleted_id": deleted["id"]})
		px := pos["x"]
		py := pos["y"]
		pz := pos["z"]
		httphelper.JSON(w, map[string]any{"status": "success", "message": fmt.Sprintf("Deleted model at position (%v, %v, %v)", px, py, pz)})
		return
	}
	httphelper.JSONNotFound(w, "Model not found")
}

func editModel(w http.ResponseWriter, r *http.Request) {
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
	category := optString(body, "category")
	modelID := optString(body, "id")
	if (category == "") || (modelID == "") {
		httphelper.JSONBadRequest(w, "Missing required parameters")
		return
	}
	townData, gerr := storage.Get()
	if gerr != nil {
		httphelper.JSONError(w, "Failed to load town data", 500)
		return
	}
	v, vok := townData[category]
	if !vok {
		httphelper.JSONNotFound(w, "Model not found")
		return
	}
	arr, aok := v.([]any)
	if !aok {
		httphelper.JSONNotFound(w, "Model not found")
		return
	}
	for i := range len(arr) {
		entry, eok := arr[i].(map[string]any)
		if !eok {
			continue
		}
		if optString(entry, "id") == modelID {
			if pos, pok := optMap(body, "position"); pok {
				entry["position"] = pos
			}
			if rot, rok := optMap(body, "rotation"); rok {
				entry["rotation"] = rot
			}
			if scl, sok := optMap(body, "scale"); sok {
				entry["scale"] = scl
			}
			arr[i] = entry
			townData[category] = arr
			town_helpers.SaveAndBroadcast(townData, map[string]any{"type": "edit", "category": category, "id": modelID, "data": entry})
			httphelper.JSON(w, map[string]any{"status": "success", "message": fmt.Sprintf("Updated model with ID %v", modelID)})
			return
		}
	}
	httphelper.JSONNotFound(w, "Model not found")
}

func getConfig(w http.ResponseWriter, r *http.Request) {
	u, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	httphelper.JSON(w, map[string]any{"apiUrl": "/api/proxy/towns", "authenticated": true, "user": u.Username})
}

func Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/town", getTown)
	mux.HandleFunc("POST /api/town", updateTown)
	mux.HandleFunc("POST /api/town/save", saveTown)
	mux.HandleFunc("POST /api/town/load", loadTown)
	mux.HandleFunc("GET /api/town/load-from-django/{id}", loadFromDjango)
	mux.HandleFunc("DELETE /api/town/model", deleteModel)
	mux.HandleFunc("PUT /api/town/model", editModel)
	mux.HandleFunc("GET /api/config", getConfig)
}
