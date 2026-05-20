package normalization

import (
	"github.com/kukichalang/kukicha/stdlib/cast"
	"github.com/kukichalang/kukicha/stdlib/maps"
)

var Categories = []string{"buildings", "vehicles", "trees", "props", "street", "park", "terrain", "roads"}

type Vec3 = map[string]float64

func toFloat(v any, def float64) float64 {
	out, err := cast.SmartFloat64(v)
	if err != nil {
		return def
	}
	return out
}

func vecFromAny(values any, dx float64, dy float64, dz float64) Vec3 {
	if values == nil {
		return Vec3{"x": dx, "y": dy, "z": dz}
	}
	arr, okArr := values.([]any)
	if okArr && (len(arr) >= 3) {
		return Vec3{"x": toFloat(arr[0], dx), "y": toFloat(arr[1], dy), "z": toFloat(arr[2], dz)}
	}
	m, okMap := values.(map[string]any)
	if okMap {
		return Vec3{"x": toFloat(m["x"], dx), "y": toFloat(m["y"], dy), "z": toFloat(m["z"], dz)}
	}
	return Vec3{"x": dx, "y": dy, "z": dz}
}

func normalizeObject(item map[string]any, category string) map[string]any {
	out := make(map[string]any)
	for k, v := range item {
		out[k] = v
	}
	out["category"] = category
	model, hasModel := item["model"]
	if !hasModel || (model == nil) {
		if alt, ok := item["modelName"]; ok {
			model = alt
		}
	}
	out["model"] = model
	out["position"] = vecFromAny(item["position"], 0.0, 0.0, 0.0)
	out["rotation"] = vecFromAny(item["rotation"], 0.0, 0.0, 0.0)
	out["scale"] = vecFromAny(item["scale"], 1.0, 1.0, 1.0)
	return out
}

func normalizeList(items any, category string) []map[string]any {
	out := []map[string]any{}
	arr, ok := items.([]any)
	if !ok {
		return out
	}
	for _, raw := range arr {
		item, isMap := raw.(map[string]any)
		if !isMap {
			continue
		}
		out = append(out, normalizeObject(item, category))
	}
	return out
}

func Normalize(layoutData any) map[string]any {
	out := make(map[string]any)
	inMap, isMap := layoutData.(map[string]any)
	if isMap {
		for _, category := range Categories {
			out[category] = normalizeList(inMap[category], category)
		}
		keys := maps.Keys(inMap)
		for i := range len(keys) {
			name := keys[i]
			if _, taken := out[name]; !taken {
				out[name] = inMap[name]
			}
		}
		return out
	}
	arr, isList := layoutData.([]any)
	if isList {
		for _, category := range Categories {
			out[category] = []map[string]any{}
		}
		for _, raw := range arr {
			item, okItem := raw.(map[string]any)
			if !okItem {
				continue
			}
			catAny, hasCat := item["category"]
			if !hasCat {
				continue
			}
			cat, okCat := catAny.(string)
			if !okCat {
				continue
			}
			existing, present := out[cat]
			if !present {
				continue
			}
			asList, okList := existing.([]map[string]any)
			if !okList {
				continue
			}
			out[cat] = append(asList, normalizeObject(item, cat))
		}
		return out
	}
	for _, category := range Categories {
		out[category] = []map[string]any{}
	}
	return out
}
