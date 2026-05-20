package health

import (
	"fmt"
	"github.com/duber000/town-builder/internal/storage"
	ctxpkg "github.com/kukichalang/kukicha/stdlib/ctx"
	httphelper "github.com/kukichalang/kukicha/stdlib/http"
	"github.com/kukichalang/kukicha/stdlib/log"
	"net/http"
)

func livez(w http.ResponseWriter, r *http.Request) {
	httphelper.JSON(w, map[string]any{"status": "ok"})
}

func readyz(w http.ResponseWriter, r *http.Request) {
	checks := make(map[string]any)
	status := "ok"
	client := storage.Client()
	if client == nil {
		checks["redis"] = "unavailable"
	} else {
		h := ctxpkg.WithTimeout(ctxpkg.Background(), 2_000_000_000)
		defer h.Cancel()
		perr := client.Ping(h.Ctx).Err()
		if perr != nil {
			log.Warn(fmt.Sprintf("Redis health check failed: %v", perr))
			checks["redis"] = fmt.Sprintf("error: %v", perr)
			status = "degraded"
		} else {
			checks["redis"] = "ok"
		}
	}
	body := map[string]any{"status": status, "checks": checks}
	httphelper.JSON(w, body)
}

func Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /healthz", livez)
	mux.HandleFunc("GET /readyz", readyz)
}
