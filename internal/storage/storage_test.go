package storage_test

import (
	"github.com/duber000/town-builder/internal/storage"
	"github.com/kukichalang/kukicha/stdlib/test"
	"testing"
)

func resetForTest() {
	storage.SetClient(nil)
	storage.ResetMemory()
}

func TestSetAndGetRoundtrip(t *testing.T) {
	resetForTest()
	data := map[string]any{"buildings": []any{map[string]any{"id": "1", "model": "house.glb"}}, "vehicles": []any{}}
	setErr := storage.Set(data)
	test.AssertNoError(t, setErr)
	result, err := storage.Get()
	test.AssertNoError(t, err)
	buildings, ok := result["buildings"].([]any)
	test.AssertTrue(t, ok)
	test.AssertEqual(t, len(buildings), 1)
}

func TestGetReturnsDeepCopy(t *testing.T) {
	resetForTest()
	data := map[string]any{"buildings": []any{map[string]any{"id": "1"}}}
	setErr := storage.Set(data)
	test.AssertNoError(t, setErr)
	result, _ := storage.Get()
	buildings, _ := result["buildings"].([]any)
	result["buildings"] = append(buildings, map[string]any{"id": "2"})
	fresh, _ := storage.Get()
	freshBuildings, _ := fresh["buildings"].([]any)
	test.AssertEqual(t, len(freshBuildings), 1)
}

func TestEmptyInitialState(t *testing.T) {
	resetForTest()
	result, _ := storage.Get()
	for _, key := range []string{"buildings", "vehicles", "terrain"} {
		items, ok := result[key].([]any)
		test.AssertTrue(t, ok)
		test.AssertEqual(t, len(items), 0)
	}
}

func TestFallbackWhenRedisUnavailable(t *testing.T) {
	resetForTest()
	test.AssertTrue(t, (storage.Client() == nil))
	e1 := storage.Set(map[string]any{"buildings": []any{map[string]any{"id": "x"}}})
	test.AssertNoError(t, e1)
	result, _ := storage.Get()
	buildings, _ := result["buildings"].([]any)
	test.AssertEqual(t, len(buildings), 1)
}

func TestOverwriteReplacesData(t *testing.T) {
	resetForTest()
	e1 := storage.Set(map[string]any{"buildings": []any{map[string]any{"id": "1"}}})
	test.AssertNoError(t, e1)
	e2 := storage.Set(map[string]any{"buildings": []any{map[string]any{"id": "2"}}})
	test.AssertNoError(t, e2)
	result, _ := storage.Get()
	buildings, _ := result["buildings"].([]any)
	test.AssertEqual(t, len(buildings), 1)
	first, _ := buildings[0].(map[string]any)
	test.AssertEqual(t, first["id"], "2")
}
