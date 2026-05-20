package static

import (
	"net/http"
	"path/filepath"
	"strings"
)

func mimeFor(p string) string {
	ext := strings.ToLower(filepath.Ext(p))
	if strings.HasSuffix(strings.ToLower(p), ".d.ts") {
		return "text/plain"
	}
	switch ext {
	case ".js", ".mjs":
		return "application/javascript"
	case ".wasm":
		return "application/wasm"
	case ".css":
		return "text/css"
	case ".html":
		return "text/html; charset=utf-8"
	case ".json":
		return "application/json"
	case ".svg":
		return "image/svg+xml"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".ico":
		return "image/x-icon"
	default:
		return ""
	}
}

type mimeHandler struct {
	next http.Handler
}

func (h *mimeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if m := mimeFor(r.URL.Path); m != "" {
		w.Header().Set("Content-Type", m)
	}
	h.next.ServeHTTP(w, r)
}

func Register(mux *http.ServeMux) {
	fs := http.FileServer(http.Dir("./static"))
	handler := http.StripPrefix("/static/", fs)
	mux.Handle("/static/", &mimeHandler{next: handler})
}
