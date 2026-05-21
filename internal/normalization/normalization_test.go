package normalization_test

import (
	"github.com/duber000/town-builder/internal/normalization"
	"github.com/kukichalang/kukicha/stdlib/test"
	"testing"
)

func sampleDict() map[string]any {
	return map[string]any{"buildings": []any{map[string]any{"id": "bld-001", "model": "house.glb", "category": "buildings", "position": map[string]any{"x": 10.0, "y": 0.0, "z": 5.0}, "rotation": map[string]any{"x": 0.0, "y": 1.57, "z": 0.0}, "scale": map[string]any{"x": 1.0, "y": 1.0, "z": 1.0}}}, "vehicles": []any{}, "trees": []any{}, "props": []any{}, "street": []any{}, "park": []any{}, "terrain": []any{}, "roads": []any{}, "townName": "Springfield"}
}

func sampleArray() []any {
	return []any{map[string]any{"category": "buildings", "model": "house.glb", "position": []any{10, 0, 5}, "rotation": []any{0, 1.57, 0}, "scale": []any{1, 1, 1}}, map[string]any{"category": "vehicles", "model": "car.glb", "position": []any{20, 0, 15}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}}
}

func TestCanonicalDictPassthrough(t *testing.T) {
	result := normalization.Normalize(sampleDict())
	buildings, _ := result["buildings"].([]map[string]any)
	test.AssertEqual(t, len(buildings), 1)
	bld := buildings[0]
	test.AssertEqual(t, bld["model"], "house.glb")
	pos, _ := bld["position"].(normalization.Vec3)
	test.AssertEqual(t, pos["x"], 10.0)
	test.AssertEqual(t, pos["y"], 0.0)
	test.AssertEqual(t, pos["z"], 5.0)
	rot, _ := bld["rotation"].(normalization.Vec3)
	test.AssertEqual(t, rot["y"], 1.57)
	scale, _ := bld["scale"].(normalization.Vec3)
	test.AssertEqual(t, scale["x"], 1.0)
}

func TestAllCategoriesPresent(t *testing.T) {
	result := normalization.Normalize(sampleDict())
	for _, cat := range normalization.Categories {
		_, present := result[cat]
		test.AssertTrue(t, present)
	}
}

func TestExtraTopLevelKeysPreserved(t *testing.T) {
	data := sampleDict()
	data["customField"] = "custom_value"
	data["version"] = 2
	result := normalization.Normalize(data)
	test.AssertEqual(t, result["townName"], "Springfield")
	test.AssertEqual(t, result["customField"], "custom_value")
	test.AssertEqual(t, result["version"], 2)
}

func TestEmptyDictReturnsEmptyCategories(t *testing.T) {
	result := normalization.Normalize(map[string]any{})
	for _, cat := range normalization.Categories {
		items, ok := result[cat].([]map[string]any)
		test.AssertTrue(t, ok)
		test.AssertEqual(t, len(items), 0)
	}
}

func TestArrayToDictConversion(t *testing.T) {
	result := normalization.Normalize(sampleArray())
	buildings, _ := result["buildings"].([]map[string]any)
	vehicles, _ := result["vehicles"].([]map[string]any)
	test.AssertEqual(t, len(buildings), 1)
	test.AssertEqual(t, len(vehicles), 1)
	test.AssertEqual(t, buildings[0]["model"], "house.glb")
	test.AssertEqual(t, vehicles[0]["model"], "car.glb")
}

func TestUnknownCategoriesIgnored(t *testing.T) {
	data := []any{map[string]any{"category": "dragons", "model": "dragon.glb", "position": []any{0, 0, 0}}}
	result := normalization.Normalize(data)
	for _, cat := range normalization.Categories {
		items, _ := result[cat].([]map[string]any)
		test.AssertEqual(t, len(items), 0)
	}
}

func TestNonDictItemsSkipped(t *testing.T) {
	data := []any{map[string]any{"category": "buildings", "model": "house.glb"}, "not a dict", 42, nil}
	result := normalization.Normalize(data)
	buildings, _ := result["buildings"].([]map[string]any)
	test.AssertEqual(t, len(buildings), 1)
}

func TestPositionArrayToDict(t *testing.T) {
	data := map[string]any{"buildings": []any{map[string]any{"model": "h.glb", "position": []any{1, 2, 3}}}}
	result := normalization.Normalize(data)
	buildings, _ := result["buildings"].([]map[string]any)
	pos, _ := buildings[0]["position"].(normalization.Vec3)
	test.AssertEqual(t, pos["x"], 1.0)
	test.AssertEqual(t, pos["y"], 2.0)
	test.AssertEqual(t, pos["z"], 3.0)
}

func TestPositionDictPreserved(t *testing.T) {
	data := map[string]any{"buildings": []any{map[string]any{"model": "h.glb", "position": map[string]any{"x": 5, "y": 6, "z": 7}}}}
	result := normalization.Normalize(data)
	buildings, _ := result["buildings"].([]map[string]any)
	pos, _ := buildings[0]["position"].(normalization.Vec3)
	test.AssertEqual(t, pos["x"], 5.0)
	test.AssertEqual(t, pos["y"], 6.0)
	test.AssertEqual(t, pos["z"], 7.0)
}

func TestMissingPositionDefaultsZero(t *testing.T) {
	data := map[string]any{"buildings": []any{map[string]any{"model": "h.glb"}}}
	result := normalization.Normalize(data)
	buildings, _ := result["buildings"].([]map[string]any)
	pos, _ := buildings[0]["position"].(normalization.Vec3)
	test.AssertEqual(t, pos["x"], 0.0)
	test.AssertEqual(t, pos["y"], 0.0)
	test.AssertEqual(t, pos["z"], 0.0)
}

func TestMissingScaleDefaultsOne(t *testing.T) {
	data := map[string]any{"buildings": []any{map[string]any{"model": "h.glb"}}}
	result := normalization.Normalize(data)
	buildings, _ := result["buildings"].([]map[string]any)
	scale, _ := buildings[0]["scale"].(normalization.Vec3)
	test.AssertEqual(t, scale["x"], 1.0)
	test.AssertEqual(t, scale["y"], 1.0)
	test.AssertEqual(t, scale["z"], 1.0)
}

func TestModelNameNormalizedToModel(t *testing.T) {
	data := map[string]any{"buildings": []any{map[string]any{"modelName": "house.glb"}}}
	result := normalization.Normalize(data)
	buildings, _ := result["buildings"].([]map[string]any)
	test.AssertEqual(t, buildings[0]["model"], "house.glb")
}

func TestNoneReturnsEmpty(t *testing.T) {
	result := normalization.Normalize(nil)
	for _, cat := range normalization.Categories {
		items, _ := result[cat].([]map[string]any)
		test.AssertEqual(t, len(items), 0)
	}
}

func TestIntReturnsEmpty(t *testing.T) {
	result := normalization.Normalize(42)
	for _, cat := range normalization.Categories {
		items, _ := result[cat].([]map[string]any)
		test.AssertEqual(t, len(items), 0)
	}
}

func TestStringReturnsEmpty(t *testing.T) {
	result := normalization.Normalize("not valid")
	for _, cat := range normalization.Categories {
		items, _ := result[cat].([]map[string]any)
		test.AssertEqual(t, len(items), 0)
	}
}
