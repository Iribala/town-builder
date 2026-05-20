package bodylimit

import (
	"fmt"
	"github.com/duber000/town-builder/internal/config"
	httphelper "github.com/kukichalang/kukicha/stdlib/http"
	"net/http"
	"strconv"
)

func Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s := config.Current()
		limit := int64(((10 * 1024) * 1024))
		if s != nil {
			limit = s.MaxRequestBodyBytes
		}
		cl := r.Header.Get("Content-Length")
		if cl != "" {
			n, err := strconv.ParseInt(cl, 10, 64)
			if (err == nil) && (n > limit) {
				httphelper.JSONError(w, fmt.Sprintf("Request body too large. Maximum size: %v bytes", limit), 413)
				return
			}
		}
		r.Body = http.MaxBytesReader(w, r.Body, limit)
		next.ServeHTTP(w, r)
	})
}
