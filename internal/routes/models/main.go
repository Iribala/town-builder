package models

import (
	"github.com/duber000/town-builder/internal/config"
	"github.com/duber000/town-builder/internal/routes/common"
	"github.com/duber000/town-builder/internal/services/model_loader"
	"github.com/duber000/town-builder/internal/utils/security"
	httphelper "github.com/kukichalang/kukicha/stdlib/http"
	"net/http"
	"os"
	"path/filepath"
)

func listModels(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	httphelper.JSON(w, model_loader.GetAvailableModels())
}

func getModel(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	category := r.PathValue("category")
	modelName := r.PathValue("model_name")
	vc, vn, err := security.ValidateModelPath(category, modelName)
	if err != nil {
		httphelper.JSONBadRequest(w, "Invalid model path")
		return
	}
	s := config.Current()
	if s == nil {
		httphelper.JSONError(w, "config not loaded", 500)
		return
	}
	modelPath := filepath.Join(s.ModelsPath, vc, vn)
	_, statErr := os.Stat(modelPath)
	if statErr != nil {
		httphelper.JSONNotFound(w, "Model not found")
		return
	}
	info := r.URL.Query().Get("info")
	if info == "1" {
		body := map[string]any{"name": modelName, "category": category, "has_bin": fileExists((modelPath[:(len(modelPath)-len(filepath.Ext(modelPath)))] + ".bin"))}
		httphelper.JSON(w, body)
		return
	}
	http.ServeFile(w, r, modelPath)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return (err == nil)
}

func Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/models", listModels)
	mux.HandleFunc("GET /api/model/{category}/{model_name}", getModel)
}
