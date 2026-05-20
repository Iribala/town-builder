package ui

import (
	"errors"
	"fmt"
	"github.com/duber000/town-builder/internal/config"
	"github.com/duber000/town-builder/internal/services/model_display_names"
	"github.com/duber000/town-builder/internal/services/model_loader"
	httphelper "github.com/kukichalang/kukicha/stdlib/http"
	"github.com/kukichalang/kukicha/stdlib/log"
	"html/template"
	"net/http"
	"os"
	"strconv"
	"strings"
)

var indexTmpl *template.Template

func titleCase(s string) string {
	if s == "" {
		return s
	}
	return (strings.ToUpper(s[:1]) + s[1:])
}

func loadTemplate() error {
	s := config.Current()
	if s == nil {
		return errors.New("config not loaded")
	}
	path := (s.TemplatesPath + "/index.html")
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	funcs := template.FuncMap{"title": titleCase, "displayName": model_display_names.GetModelDisplayName}
	t, perr := template.New("index.html").Funcs(funcs).Parse(string(raw))
	if perr != nil {
		return perr
	}
	indexTmpl = t
	return nil
}

func basePath() string {
	s := config.Current()
	if s == nil {
		return ""
	}
	return strings.TrimRight(s.RootPath, "/")
}

type indexData struct {
	Models   map[string][]string
	TownID   int
	Token    string
	BasePath string
}

func index(w http.ResponseWriter, r *http.Request) {
	if indexTmpl == nil {
		if err := loadTemplate(); err != nil {
			log.Error(fmt.Sprintf("Failed to load index template: %v", err))
			httphelper.JSONError(w, "template load failed", 500)
			return
		}
	}
	townID := 0
	if v := r.URL.Query().Get("town_id"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			townID = n
		}
	}
	data := indexData{Models: model_loader.GetAvailableModels(), TownID: townID, Token: r.URL.Query().Get("token"), BasePath: basePath()}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := indexTmpl.Execute(w, data); err != nil {
		log.Error(fmt.Sprintf("Failed to render index: %v", err))
	}
}

func favicon(w http.ResponseWriter, r *http.Request) {
	path := "static/favicon.ico"
	if _, err := os.Stat(path); err != nil {
		httphelper.JSONNotFound(w, "Favicon not found")
		return
	}
	http.ServeFile(w, r, path)
}

func Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /{$}", index)
	mux.HandleFunc("GET /favicon.ico", favicon)
}
