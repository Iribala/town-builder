package batch_test

import (
	"github.com/duber000/town-builder/internal/config"
	"github.com/duber000/town-builder/internal/services/batch"
	"github.com/duber000/town-builder/internal/storage"
	"github.com/kukichalang/kukicha/stdlib/test"
	"testing"
)

func setupBatch() {
	s := &config.Settings{DisableJwtAuth: true, Environment: "development", MaxRequestBodyBytes: ((10 * 1024) * 1024), MaxSseConnectionsPerUser: 3, MaxBatchOperations: 100}
	config.SetForTest(s)
	storage.SetClient(nil)
	storage.ResetMemory()
	initial := map[string]any{"buildings": []any{map[string]any{"id": "bld-1", "model": "house.glb", "category": "buildings", "position": map[string]any{"x": 0.0, "y": 0.0, "z": 0.0}}, map[string]any{"id": "bld-2", "model": "shop.glb", "category": "buildings", "position": map[string]any{"x": 10.0, "y": 0.0, "z": 10.0}}}, "vehicles": []any{}, "trees": []any{}, "props": []any{}, "street": []any{}, "park": []any{}, "terrain": []any{}, "roads": []any{}}
	_ = storage.Set(initial)
}

func TestBatchCreateAddsObject(t *testing.T) {
	setupBatch()
	ops := []map[string]any{map[string]any{"op": "create", "category": "vehicles", "data": map[string]any{"model": "car.glb", "category": "vehicles", "position": map[string]any{"x": 0.0, "y": 0.0, "z": 0.0}}}}
	results, ok, failed := batch.ExecuteOperations(ops, true)
	test.AssertEqual(t, ok, 1)
	test.AssertEqual(t, failed, 0)
	success, _ := results[0]["success"].(bool)
	test.AssertTrue(t, success)
	data, _ := storage.Get()
	vehicles, _ := data["vehicles"].([]any)
	test.AssertEqual(t, len(vehicles), 1)
}

func TestBatchCreateMissingCategoryFails(t *testing.T) {
	setupBatch()
	ops := []map[string]any{map[string]any{"op": "create", "data": map[string]any{"model": "car.glb"}}}
	_, _, failed := batch.ExecuteOperations(ops, true)
	test.AssertEqual(t, failed, 1)
}

func TestBatchDeleteById(t *testing.T) {
	setupBatch()
	ops := []map[string]any{map[string]any{"op": "delete", "category": "buildings", "id": "bld-1"}}
	_, ok, _ := batch.ExecuteOperations(ops, true)
	test.AssertEqual(t, ok, 1)
	data, _ := storage.Get()
	buildings, _ := data["buildings"].([]any)
	test.AssertEqual(t, len(buildings), 1)
	first, _ := buildings[0].(map[string]any)
	test.AssertEqual(t, first["id"], "bld-2")
}

func TestBatchDeleteNonexistentFails(t *testing.T) {
	setupBatch()
	ops := []map[string]any{map[string]any{"op": "delete", "category": "buildings", "id": "nonexistent"}}
	_, _, failed := batch.ExecuteOperations(ops, true)
	test.AssertEqual(t, failed, 1)
}

func TestBatchEditPosition(t *testing.T) {
	setupBatch()
	ops := []map[string]any{map[string]any{"op": "edit", "category": "buildings", "id": "bld-1", "position": map[string]any{"x": 99.0, "y": 0.0, "z": 99.0}}}
	_, ok, _ := batch.ExecuteOperations(ops, true)
	test.AssertEqual(t, ok, 1)
	data, _ := storage.Get()
	buildings, _ := data["buildings"].([]any)
	first, _ := buildings[0].(map[string]any)
	pos, _ := first["position"].(map[string]any)
	test.AssertEqual(t, pos["x"], 99.0)
}

func TestBatchUnknownOpFails(t *testing.T) {
	setupBatch()
	ops := []map[string]any{map[string]any{"op": "teleport", "category": "buildings", "id": "bld-1"}}
	_, _, failed := batch.ExecuteOperations(ops, true)
	test.AssertEqual(t, failed, 1)
}
