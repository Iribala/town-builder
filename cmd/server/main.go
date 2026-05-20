package main

import (
	"fmt"
	"github.com/duber000/town-builder/internal/config"
	"github.com/duber000/town-builder/internal/middleware/bodylimit"
	"github.com/duber000/town-builder/internal/middleware/cors"
	"github.com/duber000/town-builder/internal/routes/router"
	"github.com/duber000/town-builder/internal/storage"
	"github.com/kukichalang/kukicha/stdlib/log"
	"net/http"
)

func main() {
	s, err := config.Load()
	if err != nil {
		log.Fatal(fmt.Sprintf("Failed to load config: %v", err))
		return
	}
	log.Info(fmt.Sprintf("Starting %v v%v (%v)", s.AppTitle, s.AppVersion, s.Environment))
	serr := storage.Initialize(s.RedisURL)
	if serr != nil {
		log.Warn(fmt.Sprintf("Redis init failed, using in-memory fallback: %v", serr))
	}
	defer storage.Close()
	cors.Init()
	mux := router.NewMux()
	handler := bodylimit.Wrap(cors.Wrap(mux))
	addr := ":5001"
	log.Info(fmt.Sprintf("Listening on %v", addr))
	lerr := http.ListenAndServe(addr, handler)
	if lerr != nil {
		log.Fatal(fmt.Sprintf("Server error: %v", lerr))
	}
}
