package query

import (
	"fmt"
	"github.com/duber000/town-builder/internal/storage"
	"github.com/duber000/town-builder/internal/utils/geometry"
	"github.com/kukichalang/kukicha/stdlib/cast"
	"github.com/kukichalang/kukicha/stdlib/log"
	"math"
	"sort"
	"strings"
)

func getAllCategories(townData map[string]any) []string {
	keys := []string{}
	for k, v := range townData {
		if (k == "snapshots") || (k == "history") {
			continue
		}
		_, ok := v.([]any)
		if ok {
			keys = append(keys, k)
		}
	}
	return keys
}

func toMap(v any) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	return m, ok
}

func sortLess(items []map[string]any, field string, reverse bool, i int, j int) bool {
	a := getNestedValue(items[i], field)
	b := getNestedValue(items[j], field)
	cmp := compareValues(a, b)
	if reverse {
		return (cmp > 0)
	}
	return (cmp < 0)
}

func distanceLess(items []map[string]any, i int, j int) bool {
	a, _ := cast.SmartFloat64(items[i]["distance"])
	b, _ := cast.SmartFloat64(items[j]["distance"])
	return (a < b)
}

func sortByDistance(items []map[string]any) {
	sort.Slice(items, func(i int, j int) bool { return distanceLess(items, i, j) })
}

func cloneWithCat(obj map[string]any, cat string) map[string]any {
	out := make(map[string]any)
	for k, v := range obj {
		out[k] = v
	}
	out["category"] = cat
	return out
}

func SpatialQueryRadius(center map[string]any, radius float64, category string, limit int) []map[string]any {
	townData, _ := storage.Get()
	results := []map[string]any{}
	cats := []string{}
	if category != "" {
		cats = []string{category}
	} else {
		cats = getAllCategories(townData)
	}
	for _, cat := range cats {
		catVal, ok := townData[cat]
		if !ok {
			continue
		}
		items, lok := catVal.([]any)
		if !lok {
			continue
		}
		for _, item := range items {
			obj, mok := toMap(item)
			if !mok {
				continue
			}
			pos, _ := toMap(obj["position"])
			distance := geometry.CalculateDistance(center, pos)
			if distance <= radius {
				entry := cloneWithCat(obj, cat)
				entry["distance"] = distance
				results = append(results, entry)
			}
		}
	}
	sortByDistance(results)
	if (limit > 0) && (len(results) > limit) {
		results = results[:limit]
	}
	log.Info(fmt.Sprintf("Radius query: found %v objects within %v units", len(results), radius))
	return results
}

func isWithinBounds(point map[string]any, minPoint map[string]any, maxPoint map[string]any) bool {
	px, _ := cast.SmartFloat64(point["x"])
	py, _ := cast.SmartFloat64(point["y"])
	pz, _ := cast.SmartFloat64(point["z"])
	mnx, mnxOk := cast.SmartFloat64(minPoint["x"])
	if !(mnxOk == nil) {
		mnx = math.Inf(-1)
	}
	mny, mnyOk := cast.SmartFloat64(minPoint["y"])
	if !(mnyOk == nil) {
		mny = math.Inf(-1)
	}
	mnz, mnzOk := cast.SmartFloat64(minPoint["z"])
	if !(mnzOk == nil) {
		mnz = math.Inf(-1)
	}
	mxx, mxxOk := cast.SmartFloat64(maxPoint["x"])
	if !(mxxOk == nil) {
		mxx = math.Inf(1)
	}
	mxy, mxyOk := cast.SmartFloat64(maxPoint["y"])
	if !(mxyOk == nil) {
		mxy = math.Inf(1)
	}
	mxz, mxzOk := cast.SmartFloat64(maxPoint["z"])
	if !(mxzOk == nil) {
		mxz = math.Inf(1)
	}
	return ((((((mnx <= px) && (px <= mxx)) && (mny <= py)) && (py <= mxy)) && (mnz <= pz)) && (pz <= mxz))
}

func SpatialQueryBounds(minPoint map[string]any, maxPoint map[string]any, category string, limit int) []map[string]any {
	townData, _ := storage.Get()
	results := []map[string]any{}
	cats := []string{}
	if category != "" {
		cats = []string{category}
	} else {
		cats = getAllCategories(townData)
	}
	for _, cat := range cats {
		catVal, ok := townData[cat]
		if !ok {
			continue
		}
		items, lok := catVal.([]any)
		if !lok {
			continue
		}
		for _, item := range items {
			obj, mok := toMap(item)
			if !mok {
				continue
			}
			pos, _ := toMap(obj["position"])
			if isWithinBounds(pos, minPoint, maxPoint) {
				results = append(results, cloneWithCat(obj, cat))
			}
		}
	}
	if (limit > 0) && (len(results) > limit) {
		results = results[:limit]
	}
	log.Info(fmt.Sprintf("Bounds query: found %v objects", len(results)))
	return results
}

func SpatialQueryNearest(point map[string]any, category string, count int, maxDistance float64, hasMaxDistance bool) []map[string]any {
	townData, _ := storage.Get()
	results := []map[string]any{}
	cats := []string{}
	if category != "" {
		cats = []string{category}
	} else {
		cats = getAllCategories(townData)
	}
	for _, cat := range cats {
		catVal, ok := townData[cat]
		if !ok {
			continue
		}
		items, lok := catVal.([]any)
		if !lok {
			continue
		}
		for _, item := range items {
			obj, mok := toMap(item)
			if !mok {
				continue
			}
			pos, _ := toMap(obj["position"])
			distance := geometry.CalculateDistance(point, pos)
			if !hasMaxDistance || (distance <= maxDistance) {
				entry := cloneWithCat(obj, cat)
				entry["distance"] = distance
				results = append(results, entry)
			}
		}
	}
	sortByDistance(results)
	if (count > 0) && (len(results) > count) {
		results = results[:count]
	}
	log.Info(fmt.Sprintf("Nearest query: found %v objects", len(results)))
	return results
}

func getNestedValue(obj map[string]any, field string) any {
	parts := strings.Split(field, ".")
	var value any = obj
	for _, part := range parts {
		m, ok := value.(map[string]any)
		if !ok {
			return nil
		}
		value = m[part]
	}
	return value
}

func compareValues(a any, b any) int {
	af, aerr := cast.SmartFloat64(a)
	bf, berr := cast.SmartFloat64(b)
	if (aerr == nil) && (berr == nil) {
		if af < bf {
			return -1
		}
		if af > bf {
			return 1
		}
		return 0
	}
	astr, aok := a.(string)
	bstr, bok := b.(string)
	if aok && bok {
		return strings.Compare(astr, bstr)
	}
	return 0
}

func evaluateCondition(objValue any, operator string, filterValue any) bool {
	if objValue == nil {
		return false
	}
	switch operator {
	case "eq":
		return (compareValues(objValue, filterValue) == 0)
	case "ne":
		return (compareValues(objValue, filterValue) != 0)
	case "gt":
		return (compareValues(objValue, filterValue) > 0)
	case "lt":
		return (compareValues(objValue, filterValue) < 0)
	case "gte":
		return (compareValues(objValue, filterValue) >= 0)
	case "lte":
		return (compareValues(objValue, filterValue) <= 0)
	case "contains":
		objStr, _ := cast.SmartString(objValue)
		filterStr, _ := cast.SmartString(filterValue)
		return strings.Contains(objStr, filterStr)
	case "in":
		items, ok := filterValue.([]any)
		if !ok {
			return false
		}
		for _, v := range items {
			if compareValues(objValue, v) == 0 {
				return true
			}
		}
		return false
	default:
		log.Warn(fmt.Sprintf("Unknown operator: %v", operator))
		return false
	}
}

func matchesFilters(obj map[string]any, filters []map[string]any) bool {
	for _, cond := range filters {
		field, _ := cond["field"].(string)
		operator, _ := cond["operator"].(string)
		value := cond["value"]
		objValue := getNestedValue(obj, field)
		if !evaluateCondition(objValue, operator, value) {
			return false
		}
	}
	return true
}

func AdvancedQuery(category string, filters []map[string]any, sortBy string, sortOrder string, limit int, offset int) []map[string]any {
	townData, _ := storage.Get()
	results := []map[string]any{}
	cats := []string{}
	if category != "" {
		cats = []string{category}
	} else {
		cats = getAllCategories(townData)
	}
	for _, cat := range cats {
		catVal, ok := townData[cat]
		if !ok {
			continue
		}
		items, lok := catVal.([]any)
		if !lok {
			continue
		}
		for _, item := range items {
			obj, mok := toMap(item)
			if !mok {
				continue
			}
			entry := cloneWithCat(obj, cat)
			if (filters != nil) && (len(filters) > 0) {
				if matchesFilters(entry, filters) {
					results = append(results, entry)
				}
			} else {
				results = append(results, entry)
			}
		}
	}
	if sortBy != "" {
		reverse := (sortOrder == "desc")
		sort.Slice(results, func(i int, j int) bool { return sortLess(results, sortBy, reverse, i, j) })
	}
	total := len(results)
	if (offset > 0) && (offset < len(results)) {
		results = results[offset:]
	} else if offset >= len(results) {
		results = []map[string]any{}
	}
	if (limit > 0) && (len(results) > limit) {
		results = results[:limit]
	}
	log.Info(fmt.Sprintf("Advanced query: found %v objects, returning %v", total, len(results)))
	return results
}
