package proxy_test

import (
	"bytes"
	"github.com/duber000/town-builder/internal/config"
	"github.com/duber000/town-builder/internal/routes/router"
	"github.com/duber000/town-builder/internal/storage"
	"github.com/kukichalang/kukicha/stdlib/json"
	"github.com/kukichalang/kukicha/stdlib/test"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func setup(djangoURL string) {
	s := &config.Settings{ApiURL: djangoURL, ApiToken: "test-token", DisableJwtAuth: true, Environment: "development", AllowedDomains: "localhost,127.0.0.1", AllowedApiDomains: []string{"localhost", "127.0.0.1"}, DataPath: "./data", StaticPath: "./static", TemplatesPath: "./templates", ModelsPath: "./static/models", MaxRequestBodyBytes: ((10 * 1024) * 1024), MaxSseConnectionsPerUser: 3}
	config.SetForTest(s)
	storage.SetClient(nil)
	storage.ResetMemory()
}

func do(mux *http.ServeMux, method string, path string, body map[string]any) (int, []byte) {
	var reader io.Reader
	if body != nil {
		data, err := json.Bytes(body)
		if err != nil {
			return 0, nil
		}
		reader = bytes.NewReader(data)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	resp := rec.Result()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, raw
}

func TestProxyGetForwards(t *testing.T) {
	var called bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`[{"id": 1, "name": "Springfield"}]`))
	}))
	defer srv.Close()
	setup((srv.URL + "/"))
	mux := router.NewMux()
	status, _ := do(mux, "GET", "/api/proxy/towns/", nil)
	test.AssertEqual(t, status, 200)
	test.AssertTrue(t, called)
}

func TestProxyGetWithPath(t *testing.T) {
	var seenPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenPath = r.URL.Path
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"id": 42}`))
	}))
	defer srv.Close()
	setup((srv.URL + "/"))
	mux := router.NewMux()
	status, _ := do(mux, "GET", "/api/proxy/towns/42/", nil)
	test.AssertEqual(t, status, 200)
	test.AssertEqual(t, seenPath, "/42/")
}

func TestProxyPostForwardsBody(t *testing.T) {
	var called bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"id": 1}`))
	}))
	defer srv.Close()
	setup((srv.URL + "/"))
	mux := router.NewMux()
	status, _ := do(mux, "POST", "/api/proxy/towns", map[string]any{"name": "Test"})
	test.AssertEqual(t, status, 201)
	test.AssertTrue(t, called)
}

func TestProxyPatchWithPath(t *testing.T) {
	var seenMethod string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenMethod = r.Method
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"id": 42}`))
	}))
	defer srv.Close()
	setup((srv.URL + "/"))
	mux := router.NewMux()
	status, _ := do(mux, "PATCH", "/api/proxy/towns/42/", map[string]any{"layout_data": map[string]any{"buildings": []any{}}})
	test.AssertEqual(t, status, 200)
	test.AssertEqual(t, seenMethod, "PATCH")
}

func TestProxyPreservesStatusCode(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		_, _ = w.Write([]byte(`{"detail": "Not found."}`))
	}))
	defer srv.Close()
	setup((srv.URL + "/"))
	mux := router.NewMux()
	status, _ := do(mux, "GET", "/api/proxy/towns/999/", nil)
	test.AssertEqual(t, status, 404)
}

func TestProxyAuthorityInPathRejected(t *testing.T) {
	setup("http://localhost:8000/api/towns/")
	mux := router.NewMux()
	status, _ := do(mux, "GET", "/api/proxy/towns/user@evil.com/", nil)
	test.AssertEqual(t, status, 400)
}

func TestProxyEncodedTraversalRejected(t *testing.T) {
	setup("http://localhost:8000/api/towns/")
	mux := router.NewMux()
	status, _ := do(mux, "GET", "/api/proxy/towns/%2e%2e/secret", nil)
	test.AssertEqual(t, status, 400)
}
