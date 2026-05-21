package town_test

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

var sampleLayout = map[string]any{"buildings": []any{map[string]any{"id": "bld-001", "model": "house.glb", "category": "buildings", "position": map[string]any{"x": 10.0, "y": 0.0, "z": 5.0}, "rotation": map[string]any{"x": 0.0, "y": 1.57, "z": 0.0}, "scale": map[string]any{"x": 1.0, "y": 1.0, "z": 1.0}}}, "vehicles": []any{}, "trees": []any{}, "props": []any{}, "street": []any{}, "park": []any{}, "terrain": []any{}, "roads": []any{}, "townName": "Springfield"}

var kibigiaTownResponse = map[string]any{"id": 42, "name": "Springfield", "description": "A test town", "population": 25000, "latitude": 42.1015, "longitude": -72.5898, "layout_data": sampleLayout, "category_statuses": []any{}}

func setup(djangoURL string) {
	s := &config.Settings{ApiURL: djangoURL, ApiToken: "test-token", DisableJwtAuth: true, Environment: "development", AllowedDomains: "localhost,127.0.0.1", AllowedApiDomains: []string{"localhost", "127.0.0.1"}, DataPath: "./data", StaticPath: "./static", TemplatesPath: "./templates", ModelsPath: "./static/models", MaxRequestBodyBytes: ((10 * 1024) * 1024), MaxSseConnectionsPerUser: 3}
	config.SetForTest(s)
	storage.SetClient(nil)
	storage.ResetMemory()
}

func newRouter() *http.ServeMux {
	return router.NewMux()
}

func doJSON(mux *http.ServeMux, method string, path string, body map[string]any) (int, map[string]any) {
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
	out := make(map[string]any)
	if len(raw) > 0 {
		_ = json.ParseInto(raw, &out)
	}
	return resp.StatusCode, out
}

func TestSaveWithTownIdPatches(t *testing.T) {
	var seenMethod string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenMethod = r.Method
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"id": 42}`))
	}))
	defer srv.Close()
	setup((srv.URL + "/"))
	mux := newRouter()
	status, body := doJSON(mux, "POST", "/api/town/save", map[string]any{"data": sampleLayout, "town_id": 42, "townName": "Springfield"})
	test.AssertEqual(t, status, 200)
	test.AssertEqual(t, body["status"], "success")
	test.AssertEqual(t, seenMethod, "PATCH")
}

func TestSaveWithoutIdSearchesThenCreates(t *testing.T) {
	var postSeen bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			w.WriteHeader(200)
			_, _ = w.Write([]byte(`[]`))
		} else if r.Method == "POST" {
			postSeen = true
			w.WriteHeader(201)
			_, _ = w.Write([]byte(`{"id": 99, "name": "NewTown"}`))
		}
	}))
	defer srv.Close()
	setup((srv.URL + "/"))
	mux := newRouter()
	status, body := doJSON(mux, "POST", "/api/town/save", map[string]any{"data": sampleLayout, "townName": "NewTown"})
	test.AssertEqual(t, status, 200)
	test.AssertTrue(t, postSeen)
	townID, _ := body["town_id"].(float64)
	test.AssertEqual(t, int(townID), 99)
}

func TestSaveWithoutIdSearchesThenPatches(t *testing.T) {
	var patchSeen bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			w.WriteHeader(200)
			_, _ = w.Write([]byte(`[{"id": 42, "name": "Springfield"}]`))
		} else if r.Method == "PATCH" {
			patchSeen = true
			w.WriteHeader(200)
			_, _ = w.Write([]byte(`{"id": 42}`))
		}
	}))
	defer srv.Close()
	setup((srv.URL + "/"))
	mux := newRouter()
	status, body := doJSON(mux, "POST", "/api/town/save", map[string]any{"data": sampleLayout, "townName": "Springfield"})
	test.AssertEqual(t, status, 200)
	test.AssertTrue(t, patchSeen)
	townID, _ := body["town_id"].(float64)
	test.AssertEqual(t, int(townID), 42)
}

func TestSaveNoDataReturns400(t *testing.T) {
	setup("http://localhost:8000/api/towns/")
	mux := newRouter()
	status, _ := doJSON(mux, "POST", "/api/town/save", map[string]any{"filename": "test.json"})
	test.AssertEqual(t, status, 400)
}

func TestDjangoErrorReturnsSuccessWithWarning(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		_, _ = w.Write([]byte(`{"error": "boom"}`))
	}))
	defer srv.Close()
	setup((srv.URL + "/"))
	mux := newRouter()
	status, body := doJSON(mux, "POST", "/api/town/save", map[string]any{"data": sampleLayout, "town_id": 42})
	test.AssertEqual(t, status, 200)
	test.AssertEqual(t, body["status"], "success")
	msg, _ := body["message"].(string)
	test.AssertTrue(t, (len(msg) > 0))
}

func TestLoadFromDjangoResponseShape(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		data, _ := json.Bytes(kibigiaTownResponse)
		_, _ = w.Write(data)
	}))
	defer srv.Close()
	setup((srv.URL + "/"))
	mux := newRouter()
	status, body := doJSON(mux, "GET", "/api/town/load-from-django/42", nil)
	test.AssertEqual(t, status, 200)
	test.AssertEqual(t, body["status"], "success")
	_, hasData := body["data"]
	test.AssertTrue(t, hasData)
	info, _ := body["town_info"].(map[string]any)
	townID, _ := info["id"].(float64)
	test.AssertEqual(t, int(townID), 42)
	test.AssertEqual(t, info["name"], "Springfield")
}

func TestLoadFromDjangoNormalizesLayout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		data, _ := json.Bytes(kibigiaTownResponse)
		_, _ = w.Write(data)
	}))
	defer srv.Close()
	setup((srv.URL + "/"))
	mux := newRouter()
	_, body := doJSON(mux, "GET", "/api/town/load-from-django/42", nil)
	data, _ := body["data"].(map[string]any)
	_, hasBuildings := data["buildings"]
	_, hasVehicles := data["vehicles"]
	_, hasTerrain := data["terrain"]
	test.AssertTrue(t, hasBuildings)
	test.AssertTrue(t, hasVehicles)
	test.AssertTrue(t, hasTerrain)
}

func TestLoadFromDjangoUnreachable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		_, _ = w.Write([]byte(`refused`))
	}))
	defer srv.Close()
	setup((srv.URL + "/"))
	mux := newRouter()
	status, _ := doJSON(mux, "GET", "/api/town/load-from-django/42", nil)
	test.AssertEqual(t, status, 500)
}

func TestGetTownReturnsCurrent(t *testing.T) {
	setup("http://localhost:8000/api/towns/")
	mux := newRouter()
	status, body := doJSON(mux, "GET", "/api/town", nil)
	test.AssertEqual(t, status, 200)
	test.AssertTrue(t, (body != nil))
}

func TestUpdateTownName(t *testing.T) {
	setup("http://localhost:8000/api/towns/")
	mux := newRouter()
	status, body := doJSON(mux, "POST", "/api/town", map[string]any{"townName": "NewName"})
	test.AssertEqual(t, status, 200)
	test.AssertEqual(t, body["status"], "success")
}

func TestFullDataUpdate(t *testing.T) {
	setup("http://localhost:8000/api/towns/")
	mux := newRouter()
	status, _ := doJSON(mux, "POST", "/api/town", sampleLayout)
	test.AssertEqual(t, status, 200)
}

func TestDeleteNonexistentReturns404(t *testing.T) {
	setup("http://localhost:8000/api/towns/")
	mux := newRouter()
	status, _ := doJSON(mux, "DELETE", "/api/town/model", map[string]any{"id": "nonexistent", "category": "buildings"})
	test.AssertEqual(t, status, 404)
}

func TestEditNonexistentReturns404(t *testing.T) {
	setup("http://localhost:8000/api/towns/")
	mux := newRouter()
	status, _ := doJSON(mux, "PUT", "/api/town/model", map[string]any{"id": "nonexistent", "category": "buildings", "position": map[string]any{"x": 1, "y": 2, "z": 3}})
	test.AssertEqual(t, status, 404)
}
