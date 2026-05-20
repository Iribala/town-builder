package proxy

import (
	"fmt"
	"github.com/duber000/town-builder/internal/routes/common"
	"github.com/duber000/town-builder/internal/services/django_client"
	httphelper "github.com/kukichalang/kukicha/stdlib/http"
	"github.com/kukichalang/kukicha/stdlib/log"
	mapspkg "github.com/kukichalang/kukicha/stdlib/maps"
	"io"
	"net/http"
	"strings"
)

var skipRequestHeaders = []string{"host", "content-length"}

var skipResponseHeaders = []string{"content-length", "transfer-encoding", "connection", "content-encoding"}

func shouldSkip(skip []string, name string) bool {
	lower := strings.ToLower(name)
	for _, s := range skip {
		if s == lower {
			return true
		}
	}
	return false
}

func collectHeaders(src map[string][]string) map[string]string {
	out := make(map[string]string)
	keys := mapspkg.Keys(src)
	for i := range len(keys) {
		k := keys[i]
		if shouldSkip(skipRequestHeaders, k) {
			continue
		}
		vs := src[k]
		if len(vs) > 0 {
			out[k] = vs[0]
		}
	}
	return out
}

func collectParams(values map[string][]string) map[string]string {
	out := make(map[string]string)
	keys := mapspkg.Keys(values)
	for i := range len(keys) {
		k := keys[i]
		vs := values[k]
		if len(vs) > 0 {
			out[k] = vs[0]
		}
	}
	return out
}

func handle(w http.ResponseWriter, r *http.Request, method string) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	path := r.PathValue("path")
	headers := collectHeaders(r.Header)
	params := collectParams(r.URL.Query())
	var body []byte
	if r.Body != nil {
		raw, ierr := io.ReadAll(r.Body)
		if ierr != nil {
			httphelper.JSONBadRequest(w, "Failed to read request body")
			return
		}
		body = raw
	}
	resp, perr := django_client.ProxyRequest(method, path, headers, params, body)
	if perr != nil {
		msg := perr.Error()
		log.Warn(fmt.Sprintf("Proxy request failed: %v", msg))
		if strings.Contains(msg, "timeout") {
			httphelper.JSONError(w, "Request to upstream service timed out", 504)
			return
		}
		if strings.Contains(msg, "not allowed") || strings.Contains(msg, "Unsupported") {
			httphelper.JSONBadRequest(w, msg)
			return
		}
		httphelper.JSONError(w, msg, 502)
		return
	}
	respKeys := mapspkg.Keys(resp.Headers)
	for i := range len(respKeys) {
		k := respKeys[i]
		if shouldSkip(skipResponseHeaders, k) {
			continue
		}
		for _, v := range resp.Headers[k] {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	if len(resp.Body) > 0 {
		w.Write(resp.Body)
	}
}

func get(w http.ResponseWriter, r *http.Request) {
	handle(w, r, "GET")
}

func post(w http.ResponseWriter, r *http.Request) {
	handle(w, r, "POST")
}

func put(w http.ResponseWriter, r *http.Request) {
	handle(w, r, "PUT")
}

func patch(w http.ResponseWriter, r *http.Request) {
	handle(w, r, "PATCH")
}

func remove(w http.ResponseWriter, r *http.Request) {
	handle(w, r, "DELETE")
}

func Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/proxy/towns/{path...}", get)
	mux.HandleFunc("POST /api/proxy/towns/{path...}", post)
	mux.HandleFunc("PUT /api/proxy/towns/{path...}", put)
	mux.HandleFunc("PATCH /api/proxy/towns/{path...}", patch)
	mux.HandleFunc("DELETE /api/proxy/towns/{path...}", remove)
	mux.HandleFunc("GET /api/proxy/towns", get)
	mux.HandleFunc("POST /api/proxy/towns", post)
}
