package batch

import (
	"fmt"
	"github.com/duber000/town-builder/internal/services/history"
	"github.com/duber000/town-builder/internal/services/town_helpers"
	"github.com/duber000/town-builder/internal/storage"
	"github.com/duber000/town-builder/internal/utils/geometry"
	"github.com/google/uuid"
	"github.com/kukichalang/kukicha/stdlib/json"
	"github.com/kukichalang/kukicha/stdlib/log"
	"math"
	"strings"
	"sync"
)

var batchLock sync.Mutex

var dataVersion int

func deepCopy(src map[string]any) map[string]any {
	data, err := json.Bytes(src)
	if err != nil {
		return make(map[string]any)
	}
	out := make(map[string]any)
	perr := json.ParseInto(data, &out)
	if perr != nil {
		return make(map[string]any)
	}
	return out
}

func opResult(success bool, op string, message string, data map[string]any) map[string]any {
	out := make(map[string]any)
	out["success"] = success
	out["op"] = op
	out["message"] = message
	if data != nil {
		out["data"] = data
	}
	return out
}

func toList(v any) ([]any, bool) {
	lst, ok := v.([]any)
	return lst, ok
}

func toMap(v any) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	return m, ok
}

func validateObject(obj map[string]any) bool {
	pos, ok := obj["position"]
	if !ok {
		return true
	}
	posMap, mok := toMap(pos)
	if !mok {
		return false
	}
	_, xok := posMap["x"]
	_, yok := posMap["y"]
	return (xok && yok)
}

func getString(m map[string]any, key string) string {
	v, ok := m[key]
	if !ok {
		return ""
	}
	s, sok := v.(string)
	if !sok {
		return ""
	}
	return s
}

func createObject(townData map[string]any, op map[string]any, validate bool) map[string]any {
	category := getString(op, "category")
	data, _ := toMap(op["data"])
	if data == nil {
		data = make(map[string]any)
	}
	if category == "" {
		return opResult(false, "create", "Missing category", nil)
	}
	_, ok := townData[category]
	if !ok {
		townData[category] = []any{}
	}
	if _, idOk := data["id"]; !idOk {
		data["id"] = uuid.NewString()
	}
	if validate && !validateObject(data) {
		return opResult(false, "create", "Object validation failed", nil)
	}
	items, _ := toList(townData[category])
	items = append(items, data)
	townData[category] = items
	result := make(map[string]any)
	result["id"] = data["id"]
	result["category"] = category
	return opResult(true, "create", fmt.Sprintf("Created object in %v", category), result)
}

func updateObject(townData map[string]any, op map[string]any, validate bool) map[string]any {
	category := getString(op, "category")
	objectID := getString(op, "id")
	data, _ := toMap(op["data"])
	if data == nil {
		data = make(map[string]any)
	}
	if (category == "") || (objectID == "") {
		return opResult(false, "update", "Missing category or id", nil)
	}
	catVal, ok := townData[category]
	if !ok {
		return opResult(false, "update", fmt.Sprintf("Category %v not found", category), nil)
	}
	items, lok := toList(catVal)
	if !lok {
		return opResult(false, "update", fmt.Sprintf("Category %v not found", category), nil)
	}
	for i := range len(items) {
		obj, mok := toMap(items[i])
		if !mok {
			continue
		}
		if getString(obj, "id") == objectID {
			for k, v := range data {
				obj[k] = v
			}
			items[i] = obj
			townData[category] = items
			result := make(map[string]any)
			result["id"] = objectID
			result["category"] = category
			return opResult(true, "update", fmt.Sprintf("Updated object %v in %v", objectID, category), result)
		}
	}
	return opResult(false, "update", fmt.Sprintf("Object %v not found", objectID), nil)
}

func deleteObject(townData map[string]any, op map[string]any, validate bool) map[string]any {
	category := getString(op, "category")
	objectID := getString(op, "id")
	position, hasPos := toMap(op["position"])
	if category == "" {
		return opResult(false, "delete", "Missing category", nil)
	}
	if (objectID == "") && !hasPos {
		return opResult(false, "delete", "Missing both id and position", nil)
	}
	catVal, ok := townData[category]
	if !ok {
		return opResult(false, "delete", fmt.Sprintf("Category %v not found", category), nil)
	}
	items, lok := toList(catVal)
	if !lok {
		return opResult(false, "delete", fmt.Sprintf("Category %v not found", category), nil)
	}
	if objectID != "" {
		for i := range len(items) {
			obj, mok := toMap(items[i])
			if !mok {
				continue
			}
			if getString(obj, "id") == objectID {
				items = append(items[:i], items[(i+1):]...)
				townData[category] = items
				result := make(map[string]any)
				result["id"] = objectID
				result["category"] = category
				return opResult(true, "delete", fmt.Sprintf("Deleted object %v from %v", objectID, category), result)
			}
		}
		return opResult(false, "delete", fmt.Sprintf("Object %v not found", objectID), nil)
	}
	closestIndex := -1
	closestDistance := math.Inf(1)
	closestID := ""
	for i := range len(items) {
		obj, mok := toMap(items[i])
		if !mok {
			continue
		}
		modelPos, _ := toMap(obj["position"])
		distance := geometry.CalculateDistance(position, modelPos)
		if distance < closestDistance {
			closestDistance = distance
			closestIndex = i
			closestID = getString(obj, "id")
		}
	}
	if (closestIndex >= 0) && (closestDistance < geometry.DeleteProximityThreshold) {
		items = append(items[:closestIndex], items[(closestIndex+1):]...)
		townData[category] = items
		result := make(map[string]any)
		result["id"] = closestID
		result["category"] = category
		result["distance"] = closestDistance
		return opResult(true, "delete", "Deleted model at position", result)
	}
	return opResult(false, "delete", "No model found within range at position", nil)
}

func editObject(townData map[string]any, op map[string]any, validate bool) map[string]any {
	category := getString(op, "category")
	objectID := getString(op, "id")
	position, hasPos := op["position"]
	rotation, hasRot := op["rotation"]
	scale, hasScale := op["scale"]
	if (category == "") || (objectID == "") {
		return opResult(false, "edit", "Missing category or id", nil)
	}
	catVal, ok := townData[category]
	if !ok {
		return opResult(false, "edit", fmt.Sprintf("Category %v not found", category), nil)
	}
	items, lok := toList(catVal)
	if !lok {
		return opResult(false, "edit", fmt.Sprintf("Category %v not found", category), nil)
	}
	for i := range len(items) {
		obj, mok := toMap(items[i])
		if !mok {
			continue
		}
		if getString(obj, "id") == objectID {
			changesMade := []string{}
			if hasPos && (position != nil) {
				obj["position"] = position
				changesMade = append(changesMade, "position")
			}
			if hasRot && (rotation != nil) {
				obj["rotation"] = rotation
				changesMade = append(changesMade, "rotation")
			}
			if hasScale && (scale != nil) {
				obj["scale"] = scale
				changesMade = append(changesMade, "scale")
			}
			items[i] = obj
			townData[category] = items
			result := make(map[string]any)
			result["id"] = objectID
			result["category"] = category
			result["changes"] = changesMade
			joined := strings.Join(changesMade, ", ")
			return opResult(true, "edit", fmt.Sprintf("Edited object %v in %v (%v changed)", objectID, category, joined), result)
		}
	}
	return opResult(false, "edit", fmt.Sprintf("Object %v not found", objectID), nil)
}

func executeSingle(townData map[string]any, op map[string]any, validate bool) map[string]any {
	opType := getString(op, "op")
	switch opType {
	case "create":
		return createObject(townData, op, validate)
	case "update":
		return updateObject(townData, op, validate)
	case "delete":
		return deleteObject(townData, op, validate)
	case "edit":
		return editObject(townData, op, validate)
	default:
		return opResult(false, opType, fmt.Sprintf("Unknown operation type: %v", opType), nil)
	}
}

func ExecuteOperations(operations []map[string]any, validate bool) ([]map[string]any, int, int) {
	batchLock.Lock()
	defer batchLock.Unlock()
	results := []map[string]any{}
	successful := 0
	failed := 0
	townData, _ := storage.Get()
	originalTownData := deepCopy(townData)
	for _, op := range operations {
		result := executeSingle(townData, op, validate)
		success, _ := result["success"].(bool)
		if success {
			successful = (successful + 1)
		} else {
			failed = (failed + 1)
		}
		results = append(results, result)
	}
	if failed == 0 {
		dataVersion = (dataVersion + 1)
		broadcastData := make(map[string]any)
		for k, v := range townData {
			if !strings.HasPrefix(k, "_") {
				broadcastData[k] = v
			}
		}
		event := make(map[string]any)
		event["type"] = "full"
		event["town"] = broadcastData
		serr := town_helpers.SaveAndBroadcast(broadcastData, event)
		if serr != nil {
			log.Warn(fmt.Sprintf("Batch save failed: %v", serr))
		}
		_, herr := history.AddEntry("batch", "", "", originalTownData, townData)
		if herr != nil {
			log.Warn(fmt.Sprintf("Batch history add failed: %v", herr))
		}
		log.Info(fmt.Sprintf("Batch operations completed: %v successful, %v failed", successful, failed))
	} else {
		log.Warn(fmt.Sprintf("Batch operations had failures, rolling back. %v successful, %v failed", successful, failed))
	}
	return results, successful, failed
}
