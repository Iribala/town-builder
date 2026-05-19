package scene_description

import (
	"fmt"
	"github.com/duber000/town-builder/internal/normalization"
	"github.com/duber000/town-builder/internal/services/model_display_names"
	"github.com/kukichalang/kukicha/stdlib/cast"
	"github.com/kukichalang/kukicha/stdlib/log"
	"strings"
)

func getModelNameFriendly(modelFilename string) string {
	return model_display_names.GetModelDisplayName(modelFilename)
}

func toMap(v any) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	return m, ok
}

func toList(v any) ([]any, bool) {
	l, ok := v.([]any)
	return l, ok
}

func analyzeCategory(categoryData []any, categoryName string) map[string]any {
	out := make(map[string]any)
	if categoryData == nil {
		out["count"] = 0
		out["models"] = make(map[string]int)
		out["has_drivers"] = false
		out["driver_count"] = 0
		out["positions"] = [][]float64{}
		return out
	}
	modelCounts := make(map[string]int)
	driverCount := 0
	positions := [][]float64{}
	for _, raw := range categoryData {
		obj, ok := toMap(raw)
		if !ok {
			continue
		}
		model := "unknown"
		if mv, mok := obj["model"]; mok {
			if ms, mss := mv.(string); mss {
				model = ms
			}
		}
		modelCounts[model] = (modelCounts[model] + 1)
		if d, ok := obj["driver"]; ok && (d != nil) {
			driverCount = (driverCount + 1)
		}
		pos, pok := toMap(obj["position"])
		if pok {
			x, _ := cast.SmartFloat64(pos["x"])
			y, _ := cast.SmartFloat64(pos["y"])
			z, _ := cast.SmartFloat64(pos["z"])
			positions = append(positions, []float64{x, y, z})
		}
	}
	out["count"] = len(categoryData)
	out["models"] = modelCounts
	out["has_drivers"] = (driverCount > 0)
	out["driver_count"] = driverCount
	out["positions"] = positions
	return out
}

func calculateSceneBounds(allPositions [][]float64) map[string]any {
	out := make(map[string]any)
	minObj := make(map[string]any)
	maxObj := make(map[string]any)
	dims := make(map[string]any)
	if len(allPositions) == 0 {
		minObj["x"] = 0.0
		minObj["y"] = 0.0
		minObj["z"] = 0.0
		maxObj["x"] = 0.0
		maxObj["y"] = 0.0
		maxObj["z"] = 0.0
		dims["width"] = 0.0
		dims["height"] = 0.0
		dims["depth"] = 0.0
		out["min"] = minObj
		out["max"] = maxObj
		out["dimensions"] = dims
		return out
	}
	minX := allPositions[0][0]
	maxX := allPositions[0][0]
	minY := allPositions[0][1]
	maxY := allPositions[0][1]
	minZ := allPositions[0][2]
	maxZ := allPositions[0][2]
	for _, pos := range allPositions {
		if pos[0] < minX {
			minX = pos[0]
		}
		if pos[0] > maxX {
			maxX = pos[0]
		}
		if pos[1] < minY {
			minY = pos[1]
		}
		if pos[1] > maxY {
			maxY = pos[1]
		}
		if pos[2] < minZ {
			minZ = pos[2]
		}
		if pos[2] > maxZ {
			maxZ = pos[2]
		}
	}
	minObj["x"] = minX
	minObj["y"] = minY
	minObj["z"] = minZ
	maxObj["x"] = maxX
	maxObj["y"] = maxY
	maxObj["z"] = maxZ
	dims["width"] = (maxX - minX)
	dims["height"] = (maxY - minY)
	dims["depth"] = (maxZ - minZ)
	out["min"] = minObj
	out["max"] = maxObj
	out["dimensions"] = dims
	return out
}

func formatModels(catData map[string]any) string {
	modelsVal, _ := catData["models"]
	models, ok := modelsVal.(map[string]int)
	if !ok {
		return ""
	}
	parts := []string{}
	keys := []string{}
	for k := range models {
		keys = append(keys, k)
	}
	for _, k := range keys {
		cnt := models[k]
		parts = append(parts, fmt.Sprintf("%d %s", cnt, getModelNameFriendly(k)))
	}
	return strings.Join(parts, ", ")
}

func appendCategory(parts []string, categories map[string]any, name string, label string, suffix string, showModels bool, extra string) []string {
	catRaw, ok := categories[name]
	if !ok {
		return parts
	}
	cat, mok := toMap(catRaw)
	if !mok {
		return parts
	}
	count := 0
	if c, cok := cat["count"].(int); cok {
		count = c
	}
	if count <= 0 {
		return parts
	}
	if showModels {
		parts = append(parts, fmt.Sprintf("%s (%d): %s%s", label, count, formatModels(cat), extra))
	} else {
		parts = append(parts, fmt.Sprintf("%s: %d %s", label, count, suffix))
	}
	return parts
}

func generateNaturalDescription(analysis map[string]any) string {
	parts := []string{}
	townName := "Unnamed Town"
	if tv, ok := analysis["town_name"].(string); ok && (tv != "") {
		townName = tv
	}
	parts = append(parts, ("Scene: " + townName))
	total := 0
	if t, ok := analysis["total_objects"].(int); ok {
		total = t
	}
	if total == 0 {
		return (townName + " is currently empty with no objects placed.")
	}
	parts = append(parts, fmt.Sprintf("Total objects: %d", total))
	categories, _ := toMap(analysis["categories"])
	parts = appendCategory(parts, categories, "buildings", "Buildings", "objects", true, "")
	if vehRaw, ok := categories["vehicles"]; ok {
		vehicles, mok := toMap(vehRaw)
		if mok {
			count := 0
			if c, cok := vehicles["count"].(int); cok {
				count = c
			}
			if count > 0 {
				modelDesc := formatModels(vehicles)
				driverInfo := ""
				if hd, hok := vehicles["has_drivers"].(bool); hok && hd {
					dc := 0
					if dcv, dcok := vehicles["driver_count"].(int); dcok {
						dc = dcv
					}
					driverInfo = fmt.Sprintf(", %d in use", dc)
				}
				parts = append(parts, fmt.Sprintf("Vehicles (%d): %s%s", count, modelDesc, driverInfo))
			}
		}
	}
	parts = appendCategory(parts, categories, "trees", "Trees", "objects", true, "")
	parts = appendCategory(parts, categories, "props", "Props", "objects", false, "")
	parts = appendCategory(parts, categories, "street", "Street elements", "objects", false, "")
	parts = appendCategory(parts, categories, "park", "Park elements", "objects", false, "")
	parts = appendCategory(parts, categories, "terrain", "Terrain", "objects", false, "")
	parts = appendCategory(parts, categories, "roads", "Roads", "segments", false, "")
	bounds, _ := toMap(analysis["bounds"])
	dims, _ := toMap(bounds["dimensions"])
	width, _ := cast.SmartFloat64(dims["width"])
	depth, _ := cast.SmartFloat64(dims["depth"])
	if (width > 0.0) || (depth > 0.0) {
		parts = append(parts, fmt.Sprintf("Scene dimensions: %.1f x %.1f units", width, depth))
	}
	return strings.Join(parts, "\n")
}

func GenerateSceneDescription(townData map[string]any) map[string]any {
	log.Info("Generating scene description")
	categoryAnalysis := make(map[string]any)
	allPositions := [][]float64{}
	totalObjects := 0
	for _, category := range normalization.Categories {
		catRaw, _ := townData[category]
		catList, _ := toList(catRaw)
		analysis := analyzeCategory(catList, category)
		categoryAnalysis[category] = analysis
		if c, ok := analysis["count"].(int); ok {
			totalObjects = (totalObjects + c)
		}
		if positions, ok := analysis["positions"].([][]float64); ok {
			for _, p := range positions {
				allPositions = append(allPositions, p)
			}
		}
	}
	bounds := calculateSceneBounds(allPositions)
	townName := "Unnamed Town"
	if tn, ok := townData["townName"].(string); ok && (tn != "") {
		townName = tn
	}
	analysis := make(map[string]any)
	analysis["town_name"] = townName
	analysis["total_objects"] = totalObjects
	analysis["categories"] = categoryAnalysis
	analysis["bounds"] = bounds
	description := generateNaturalDescription(analysis)
	log.Info(fmt.Sprintf("Scene description generated: %v total objects", totalObjects))
	out := make(map[string]any)
	out["description"] = description
	out["analysis"] = analysis
	return out
}
