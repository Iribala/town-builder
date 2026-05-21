package django_client_test

import (
	"github.com/duber000/town-builder/internal/config"
	"github.com/duber000/town-builder/internal/services/django_client"
	"github.com/kukichalang/kukicha/stdlib/json"
	strpkg "github.com/kukichalang/kukicha/stdlib/string"
	"github.com/kukichalang/kukicha/stdlib/test"
	"net/http"
	"net/http/httptest"
	"testing"
)

var sampleLayout = map[string]any{"buildings": []any{map[string]any{"id": "bld-001", "model": "house.glb"}}}

func setupWithURL(apiURL string) {
	s := &config.Settings{ApiURL: apiURL, ApiToken: "test-token-123", AllowedDomains: "localhost,127.0.0.1", AllowedApiDomains: []string{"localhost", "127.0.0.1"}}
	config.SetForTest(s)
}

func newServer(handler http.HandlerFunc) *httptest.Server {
	return httptest.NewServer(handler)
}

func TestSearchFoundListResponse(t *testing.T) {
	srv := newServer(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"id": 1, "name": "Springfield"}]`))
	})
	defer srv.Close()
	setupWithURL((srv.URL + "/"))
	id, ok, err := django_client.SearchTownByName("Springfield")
	test.AssertNoError(t, err)
	test.AssertTrue(t, ok)
	test.AssertEqual(t, id, 1)
}

func TestSearchPaginatedResponse(t *testing.T) {
	srv := newServer(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"results": [{"id": 5, "name": "Boston"}]}`))
	})
	defer srv.Close()
	setupWithURL((srv.URL + "/"))
	id, ok, err := django_client.SearchTownByName("Boston")
	test.AssertNoError(t, err)
	test.AssertTrue(t, ok)
	test.AssertEqual(t, id, 5)
}

func TestSearchNotFound(t *testing.T) {
	srv := newServer(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	})
	defer srv.Close()
	setupWithURL((srv.URL + "/"))
	_, ok, err := django_client.SearchTownByName("Nonexistent")
	test.AssertNoError(t, err)
	test.AssertFalse(t, ok)
}

func TestSearchHttpErrorRaises(t *testing.T) {
	srv := newServer(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		_, _ = w.Write([]byte(`{"error": "Internal server error"}`))
	})
	defer srv.Close()
	setupWithURL((srv.URL + "/"))
	_, _, err := django_client.SearchTownByName("Springfield")
	test.AssertError(t, err)
}

func TestSearchMultipleReturnsFirst(t *testing.T) {
	srv := newServer(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"id": 10, "name": "Springfield"}, {"id": 20, "name": "Springfield"}]`))
	})
	defer srv.Close()
	setupWithURL((srv.URL + "/"))
	id, ok, err := django_client.SearchTownByName("Springfield")
	test.AssertNoError(t, err)
	test.AssertTrue(t, ok)
	test.AssertEqual(t, id, 10)
}

func TestCreatePayloadShape(t *testing.T) {
	var lastBody []byte
	srv := newServer(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, r.ContentLength)
		r.Body.Read(buf)
		lastBody = buf
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"id": 42, "name": "Springfield"}`))
	})
	defer srv.Close()
	setupWithURL((srv.URL + "/"))
	req := map[string]any{"latitude": 42.1, "longitude": -72.5}
	_, err := django_client.CreateTown(req, sampleLayout, "Springfield")
	test.AssertNoError(t, err)
	body := make(map[string]any)
	_ = json.ParseInto(lastBody, &body)
	test.AssertEqual(t, body["name"], "Springfield")
	_, hasLayout := body["layout_data"]
	test.AssertTrue(t, hasLayout)
	test.AssertEqual(t, body["latitude"], 42.1)
	test.AssertEqual(t, body["longitude"], -72.5)
}

func TestCreateExtractsId(t *testing.T) {
	srv := newServer(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"id": 42, "name": "Springfield"}`))
	})
	defer srv.Close()
	setupWithURL((srv.URL + "/"))
	result, err := django_client.CreateTown(map[string]any{}, sampleLayout, "Springfield")
	test.AssertNoError(t, err)
	townID, ok := result["town_id"].(float64)
	test.AssertTrue(t, ok)
	test.AssertEqual(t, int(townID), 42)
}

func TestCreateHttpErrorRaises(t *testing.T) {
	srv := newServer(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`{"name": ["This field is required."]}`))
	})
	defer srv.Close()
	setupWithURL((srv.URL + "/"))
	_, err := django_client.CreateTown(map[string]any{}, sampleLayout, "")
	test.AssertError(t, err)
}

func TestUpdateUsesPatch(t *testing.T) {
	var seenMethod string
	var seenPath string
	srv := newServer(func(w http.ResponseWriter, r *http.Request) {
		seenMethod = r.Method
		seenPath = r.URL.Path
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"id": 42}`))
	})
	defer srv.Close()
	setupWithURL((srv.URL + "/"))
	_, err := django_client.UpdateTown(42, map[string]any{}, sampleLayout, "Springfield")
	test.AssertNoError(t, err)
	test.AssertEqual(t, seenMethod, "PATCH")
	test.AssertTrue(t, strpkg.HasSuffix(seenPath, "/42/"))
}

func TestUpdateOmitsName(t *testing.T) {
	var lastBody []byte
	srv := newServer(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, r.ContentLength)
		r.Body.Read(buf)
		lastBody = buf
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"id": 42}`))
	})
	defer srv.Close()
	setupWithURL((srv.URL + "/"))
	_, err := django_client.UpdateTown(42, map[string]any{}, sampleLayout, "Springfield")
	test.AssertNoError(t, err)
	body := make(map[string]any)
	_ = json.ParseInto(lastBody, &body)
	_, hasName := body["name"]
	test.AssertFalse(t, hasName)
	_, hasLayout := body["layout_data"]
	test.AssertTrue(t, hasLayout)
}

func TestPrepareCreateIncludesName(t *testing.T) {
	payload := django_client.PrepareDjangoPayload(map[string]any{}, sampleLayout, "Springfield", false)
	test.AssertEqual(t, payload["name"], "Springfield")
}

func TestPrepareUpdateOmitsName(t *testing.T) {
	payload := django_client.PrepareDjangoPayload(map[string]any{}, sampleLayout, "Springfield", true)
	_, hasName := payload["name"]
	test.AssertFalse(t, hasName)
}

func TestPrepareNameFallbackToTownName(t *testing.T) {
	payload := django_client.PrepareDjangoPayload(map[string]any{}, map[string]any{"townName": "Shelbyville"}, "", false)
	test.AssertEqual(t, payload["name"], "Shelbyville")
}

func TestPrepareNameFallbackToLayoutName(t *testing.T) {
	payload := django_client.PrepareDjangoPayload(map[string]any{}, map[string]any{"name": "Ogdenville"}, "", false)
	test.AssertEqual(t, payload["name"], "Ogdenville")
}

func TestPrepareOptionalFieldsPropagated(t *testing.T) {
	payload := django_client.PrepareDjangoPayload(map[string]any{"latitude": 42.1, "description": "Nice town"}, map[string]any{}, "X", false)
	test.AssertEqual(t, payload["latitude"], 42.1)
	test.AssertEqual(t, payload["description"], "Nice town")
}

func TestBaseUrlValidPasses(t *testing.T) {
	setupWithURL("http://localhost:8000/api/towns/")
	u, err := django_client.GetBaseURL()
	test.AssertNoError(t, err)
	test.AssertEqual(t, u, "http://localhost:8000/api/towns/")
}

func TestBaseUrlInvalidDomain(t *testing.T) {
	setupWithURL("http://evil.com/api/")
	_, err := django_client.GetBaseURL()
	test.AssertError(t, err)
}

func TestBaseUrlAddsTrailingSlash(t *testing.T) {
	setupWithURL("http://localhost:8000/api/towns")
	u, err := django_client.GetBaseURL()
	test.AssertNoError(t, err)
	test.AssertTrue(t, strpkg.HasSuffix(u, "/"))
}

func TestProxyGetForwards(t *testing.T) {
	var seenPath string
	srv := newServer(func(w http.ResponseWriter, r *http.Request) {
		seenPath = r.URL.Path
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"id": 42}`))
	})
	defer srv.Close()
	setupWithURL((srv.URL + "/"))
	resp, err := django_client.ProxyRequest("GET", "42/", map[string]string{}, map[string]string{}, nil)
	test.AssertNoError(t, err)
	test.AssertEqual(t, resp.StatusCode, 200)
	test.AssertTrue(t, strpkg.HasSuffix(seenPath, "/42/"))
}

func TestProxyPostForwardsBody(t *testing.T) {
	var lastBody []byte
	srv := newServer(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, r.ContentLength)
		r.Body.Read(buf)
		lastBody = buf
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"id": 1}`))
	})
	defer srv.Close()
	setupWithURL((srv.URL + "/"))
	bodyBytes := []byte(`{"name": "Test"}`)
	_, err := django_client.ProxyRequest("POST", "", map[string]string{}, map[string]string{}, bodyBytes)
	test.AssertNoError(t, err)
	body := make(map[string]any)
	_ = json.ParseInto(lastBody, &body)
	test.AssertEqual(t, body["name"], "Test")
}

func TestProxyUnsupportedMethod(t *testing.T) {
	setupWithURL("http://localhost:8000/api/towns/")
	_, err := django_client.ProxyRequest("OPTIONS", "", map[string]string{}, map[string]string{}, nil)
	test.AssertError(t, err)
	test.AssertTrue(t, strpkg.Contains(err.Error(), "Unsupported HTTP method"))
}

func TestProxyTraversalRejected(t *testing.T) {
	setupWithURL("http://localhost:8000/api/towns/")
	_, err := django_client.ProxyRequest("GET", "../../other-api/", map[string]string{}, map[string]string{}, nil)
	test.AssertError(t, err)
	test.AssertTrue(t, strpkg.Contains(err.Error(), ".."))
}

func TestProxySchemeRejected(t *testing.T) {
	setupWithURL("http://localhost:8000/api/towns/")
	_, err := django_client.ProxyRequest("GET", "http://evil.com/", map[string]string{}, map[string]string{}, nil)
	test.AssertError(t, err)
	test.AssertTrue(t, strpkg.Contains(err.Error(), "scheme"))
}

func TestProxyAuthorityRejected(t *testing.T) {
	setupWithURL("http://localhost:8000/api/towns/")
	_, err := django_client.ProxyRequest("GET", "user@evil.com/", map[string]string{}, map[string]string{}, nil)
	test.AssertError(t, err)
	test.AssertTrue(t, strpkg.Contains(err.Error(), "@"))
}
