package snapshots

import (
	"fmt"
	"github.com/duber000/town-builder/internal/routes/common"
	snapsvc "github.com/duber000/town-builder/internal/services/snapshots"
	"github.com/duber000/town-builder/internal/services/town_helpers"
	"github.com/duber000/town-builder/internal/storage"
	httphelper "github.com/kukichalang/kukicha/stdlib/http"
	"github.com/kukichalang/kukicha/stdlib/log"
	"net/http"
)

func optString(m map[string]any, key string) string {
	if v, ok := m[key]; ok {
		if s, sok := v.(string); sok {
			return s
		}
	}
	return ""
}

func create(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	body := make(map[string]any)
	httphelper.ReadJSON(r, &body)
	townData, err := storage.Get()
	if err != nil {
		httphelper.JSONError(w, "Failed to load town data", 500)
		return
	}
	snapID, serr := snapsvc.CreateSnapshot(townData, optString(body, "name"), optString(body, "description"))
	if serr != nil {
		httphelper.JSONError(w, "Failed to create snapshot", 500)
		return
	}
	meta, _ := snapsvc.GetSnapshotMetadata(snapID)
	httphelper.JSON(w, map[string]any{"status": "success", "message": "Snapshot created", "snapshot": meta})
}

func list(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	items := snapsvc.ListSnapshots()
	httphelper.JSON(w, map[string]any{"status": "success", "snapshots": items})
}

func get(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	data, dok := snapsvc.GetSnapshot(id)
	if !dok {
		httphelper.JSONNotFound(w, "Snapshot not found")
		return
	}
	meta, _ := snapsvc.GetSnapshotMetadata(id)
	httphelper.JSON(w, map[string]any{"status": "success", "snapshot": meta, "data": data})
}

func restore(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	data, dok := snapsvc.GetSnapshot(id)
	if !dok {
		httphelper.JSONNotFound(w, "Snapshot not found")
		return
	}
	err := storage.Set(data)
	if err != nil {
		httphelper.JSONError(w, "Failed to restore", 500)
		return
	}
	town_helpers.BroadcastSSE(map[string]any{"type": "full", "town": data})
	meta, _ := snapsvc.GetSnapshotMetadata(id)
	log.Info(fmt.Sprintf("Restored snapshot: %v", id))
	name := ""
	if meta != nil {
		name = optString(meta, "name")
	}
	httphelper.JSON(w, map[string]any{"status": "success", "message": fmt.Sprintf("Restored to snapshot: %v", name), "snapshot": meta})
}

func remove(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if !snapsvc.DeleteSnapshot(id) {
		httphelper.JSONNotFound(w, "Snapshot not found")
		return
	}
	httphelper.JSON(w, map[string]any{"status": "success", "message": "Snapshot deleted"})
}

func Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/snapshots", create)
	mux.HandleFunc("GET /api/snapshots", list)
	mux.HandleFunc("GET /api/snapshots/{id}", get)
	mux.HandleFunc("POST /api/snapshots/{id}/restore", restore)
	mux.HandleFunc("DELETE /api/snapshots/{id}", remove)
}
