package cors

import (
	"fmt"
	"github.com/duber000/town-builder/internal/config"
	"github.com/kukichalang/kukicha/stdlib/log"
	"net/http"
	"strings"
)

var allowedOrigins []string

func Init() {
	s := config.Current()
	if s == nil {
		allowedOrigins = []string{}
		return
	}
	raw := s.AllowedOrigins
	parts := strings.Split(raw, ",")
	cleaned := []string{}
	for _, p := range parts {
		trimmed := strings.TrimSpace(p)
		if trimmed != "" {
			cleaned = append(cleaned, trimmed)
		}
	}
	if (len(cleaned) == 0) && strings.EqualFold(s.Environment, "development") {
		cleaned = []string{"http://localhost:3000", "http://localhost:5001", "http://127.0.0.1:5001"}
		log.Warn("Using default development CORS origins. Set ALLOWED_ORIGINS in production!")
	}
	allowedOrigins = cleaned
	log.Info(fmt.Sprintf("CORS allowed origins: %v", allowedOrigins))
}

func isAllowed(origin string) bool {
	if origin == "" {
		return false
	}
	for _, o := range allowedOrigins {
		if o == origin {
			return true
		}
	}
	return false
}

func Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if isAllowed(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			reqHeaders := r.Header.Get("Access-Control-Request-Headers")
			if reqHeaders != "" {
				w.Header().Set("Access-Control-Allow-Headers", reqHeaders)
			} else {
				w.Header().Set("Access-Control-Allow-Headers", "*")
			}
		}
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}
