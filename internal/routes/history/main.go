package history

import (
	"fmt"
	"github.com/duber000/town-builder/internal/routes/common"
	histsvc "github.com/duber000/town-builder/internal/services/history"
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

func getHistory(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	limit := httphelper.GetQueryIntOr(r, "limit", 50)
	entries := histsvc.GetHistory(limit)
	httphelper.JSON(w, map[string]any{"status": "success", "history": entries, "can_undo": histsvc.CanUndo(), "can_redo": histsvc.CanRedo()})
}

func restoreState(w http.ResponseWriter, entry map[string]any, stateKey string, action string, pastTense string, pushBack func(map[string]any)) bool {
	sv, sok := entry[stateKey]
	if !sok || (sv == nil) {
		httphelper.JSONBadRequest(w, fmt.Sprintf("Cannot %v: no %v", action, stateKey))
		return false
	}
	state, mok := sv.(map[string]any)
	if !mok {
		httphelper.JSONBadRequest(w, fmt.Sprintf("Cannot %v: invalid %v", action, stateKey))
		return false
	}
	err := storage.Set(state)
	if err != nil {
		httphelper.JSONError(w, "Failed to save state", 500)
		return false
	}
	pushBack(entry)
	town_helpers.BroadcastSSE(map[string]any{"type": "full", "town": state})
	op := optString(entry, "operation")
	log.Info(fmt.Sprintf("%v operation: %v", action, op))
	httphelper.JSON(w, map[string]any{"status": "success", "message": fmt.Sprintf("%v %v operation", pastTense, op), "can_undo": histsvc.CanUndo(), "can_redo": histsvc.CanRedo()})
	return true
}

func undo(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	if !histsvc.CanUndo() {
		httphelper.JSONBadRequest(w, "Nothing to undo")
		return
	}
	entry, eok := histsvc.PopLastEntry()
	if !eok {
		httphelper.JSONBadRequest(w, "Failed to get last operation")
		return
	}
	restoreState(w, entry, "before_state", "undo", "Undid", histsvc.PushRedoEntry)
}

func redoPushBack(entry map[string]any) {
	histsvc.AddEntry(optString(entry, "operation"), optString(entry, "category"), optString(entry, "object_id"), mapOrEmpty(entry, "before_state"), mapOrEmpty(entry, "after_state"))
}

func mapOrEmpty(m map[string]any, key string) map[string]any {
	if v, ok := m[key]; ok {
		if mm, mok := v.(map[string]any); mok {
			return mm
		}
	}
	return nil
}

func redo(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	if !histsvc.CanRedo() {
		httphelper.JSONBadRequest(w, "Nothing to redo")
		return
	}
	entry, eok := histsvc.PopRedoEntry()
	if !eok {
		httphelper.JSONBadRequest(w, "Failed to get redo operation")
		return
	}
	restoreState(w, entry, "after_state", "redo", "Redid", redoPushBack)
}

func clearHist(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	histsvc.ClearHistory()
	httphelper.JSON(w, map[string]any{"status": "success", "message": "History cleared"})
}

func Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/history", getHistory)
	mux.HandleFunc("POST /api/history/undo", undo)
	mux.HandleFunc("POST /api/history/redo", redo)
	mux.HandleFunc("DELETE /api/history", clearHist)
}
