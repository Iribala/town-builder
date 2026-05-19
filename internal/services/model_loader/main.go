package model_loader

import (
	"fmt"
	"github.com/duber000/town-builder/internal/config"
	"github.com/kukichalang/kukicha/stdlib/files"
	"github.com/kukichalang/kukicha/stdlib/log"
	strpkg "github.com/kukichalang/kukicha/stdlib/string"
	"path/filepath"
)

func GetAvailableModels() map[string][]string {
	out := make(map[string][]string)
	s := config.Current()
	if s == nil {
		return out
	}
	entries, err := files.List(s.ModelsPath)
	if err != nil {
		log.Error(fmt.Sprintf("Error listing models dir: %v", err))
		return out
	}
	for _, entry := range entries {
		category := filepath.Base(entry)
		categoryPath := filepath.Join(s.ModelsPath, category)
		if !files.IsDir(categoryPath) {
			continue
		}
		files_in_cat, ferr := files.List(categoryPath)
		if ferr != nil {
			continue
		}
		models := []string{}
		for _, filePath := range files_in_cat {
			name := filepath.Base(filePath)
			ext := strpkg.ToLower(filepath.Ext(name))
			if (ext != ".glb") && (ext != ".gltf") {
				continue
			}
			if (category == "buildings") && strpkg.Contains(name, "_withoutBase") {
				continue
			}
			models = append(models, name)
		}
		out[category] = models
	}
	return out
}
