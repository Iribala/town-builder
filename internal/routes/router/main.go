package router

import (
	"github.com/duber000/town-builder/internal/routes/auth"
	"github.com/duber000/town-builder/internal/routes/batch"
	"github.com/duber000/town-builder/internal/routes/buildings"
	"github.com/duber000/town-builder/internal/routes/cursor"
	"github.com/duber000/town-builder/internal/routes/events"
	"github.com/duber000/town-builder/internal/routes/health"
	"github.com/duber000/town-builder/internal/routes/history"
	"github.com/duber000/town-builder/internal/routes/models"
	"github.com/duber000/town-builder/internal/routes/proxy"
	"github.com/duber000/town-builder/internal/routes/query"
	"github.com/duber000/town-builder/internal/routes/scene"
	"github.com/duber000/town-builder/internal/routes/snapshots"
	staticroute "github.com/duber000/town-builder/internal/routes/static"
	"github.com/duber000/town-builder/internal/routes/town"
	"github.com/duber000/town-builder/internal/routes/ui"
	"net/http"
)

func NewMux() *http.ServeMux {
	mux := http.NewServeMux()
	health.Register(mux)
	auth.Register(mux)
	models.Register(mux)
	town.Register(mux)
	buildings.Register(mux)
	scene.Register(mux)
	events.Register(mux)
	cursor.Register(mux)
	batch.Register(mux)
	query.Register(mux)
	history.Register(mux)
	snapshots.Register(mux)
	proxy.Register(mux)
	staticroute.Register(mux)
	ui.Register(mux)
	return mux
}
