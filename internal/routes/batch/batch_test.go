package batch_test

import (
	"bytes"
	"github.com/duber000/town-builder/internal/config"
	"github.com/duber000/town-builder/internal/middleware/bodylimit"
	"github.com/duber000/town-builder/internal/routes/router"
	"github.com/duber000/town-builder/internal/storage"
	"github.com/kukichalang/kukicha/stdlib/json"
	"github.com/kukichalang/kukicha/stdlib/test"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
)

func setupLimits(maxBody int64, maxOps int) {
	s := &config.Settings{DisableJwtAuth: true, Environment: "development", MaxRequestBodyBytes: maxBody, MaxSseConnectionsPerUser: 3, MaxBatchOperations: maxOps, DataPath: "./data", StaticPath: "./static", TemplatesPath: "./templates", ModelsPath: "./static/models", AllowedDomains: "localhost,127.0.0.1", AllowedApiDomains: []string{"localhost", "127.0.0.1"}}
	config.SetForTest(s)
	storage.SetClient(nil)
	storage.ResetMemory()
}

func do(handler http.Handler, method string, path string, body map[string]any) (int, map[string]any) {
	var reader io.Reader
	bodyBytes := []byte{}
	if body != nil {
		data, err := json.Bytes(body)
		if err != nil {
			return 0, nil
		}
		bodyBytes = data
		reader = bytes.NewReader(data)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	if len(bodyBytes) > 0 {
		req.ContentLength = int64(len(bodyBytes))
		req.Header.Set("Content-Length", strconv.Itoa(len(bodyBytes)))
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	resp := rec.Result()
	raw, _ := io.ReadAll(resp.Body)
	out := make(map[string]any)
	if len(raw) > 0 {
		_ = json.ParseInto(raw, &out)
	}
	return resp.StatusCode, out
}

func buildOp(i int) map[string]any {
	return map[string]any{"op": "create", "category": "buildings", "data": map[string]any{"model": "house.glb", "category": "buildings", "position": map[string]any{"x": float64(i), "y": 0.0, "z": 0.0}}}
}

func TestSmallRequestAccepted(t *testing.T) {
	setupLimits(((10 * 1024) * 1024), 100)
	handler := bodylimit.Wrap(router.NewMux())
	status, _ := do(handler, "POST", "/api/town", map[string]any{"townName": "TestTown"})
	test.AssertEqual(t, status, 200)
}

func TestLargeRequestRejected(t *testing.T) {
	setupLimits(100, 100)
	handler := bodylimit.Wrap(router.NewMux())
	big := ""
	for range 200 {
		big = (big + "x")
	}
	status, _ := do(handler, "POST", "/api/town", map[string]any{"data": big})
	test.AssertEqual(t, status, 413)
}

func TestBatchWithinLimitAccepted(t *testing.T) {
	setupLimits(((10 * 1024) * 1024), 100)
	handler := bodylimit.Wrap(router.NewMux())
	ops := []any{}
	for i := range 5 {
		ops = append(ops, buildOp(i))
	}
	status, _ := do(handler, "POST", "/api/batch/operations", map[string]any{"operations": ops})
	test.AssertEqual(t, status, 200)
}

func TestBatchExceedsLimitRejected(t *testing.T) {
	setupLimits(((10 * 1024) * 1024), 100)
	handler := bodylimit.Wrap(router.NewMux())
	ops := []any{}
	for i := range 101 {
		ops = append(ops, buildOp(i))
	}
	status, _ := do(handler, "POST", "/api/batch/operations", map[string]any{"operations": ops})
	test.AssertEqual(t, status, 400)
}

func TestBatchAtLimitAccepted(t *testing.T) {
	setupLimits(((10 * 1024) * 1024), 100)
	handler := bodylimit.Wrap(router.NewMux())
	ops := []any{}
	for i := range 100 {
		ops = append(ops, buildOp(i))
	}
	status, _ := do(handler, "POST", "/api/batch/operations", map[string]any{"operations": ops})
	test.AssertNotEqual(t, status, 400)
}
