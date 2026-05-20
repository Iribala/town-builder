package batch

import (
	"fmt"
	"github.com/duber000/town-builder/internal/config"
	"github.com/duber000/town-builder/internal/routes/common"
	batchsvc "github.com/duber000/town-builder/internal/services/batch"
	httphelper "github.com/kukichalang/kukicha/stdlib/http"
	"github.com/kukichalang/kukicha/stdlib/log"
	"net/http"
)

func executeOps(w http.ResponseWriter, r *http.Request) {
	_, ok := common.CurrentUser(w, r)
	if !ok {
		return
	}
	body := make(map[string]any)
	err := httphelper.ReadJSON(r, &body)
	if err != nil {
		httphelper.JSONBadRequest(w, "Invalid JSON body")
		return
	}
	opsRaw, opsOk := body["operations"]
	if !opsOk {
		httphelper.JSONBadRequest(w, "operations is required")
		return
	}
	opsList, listOk := opsRaw.([]any)
	if !listOk {
		httphelper.JSONBadRequest(w, "operations must be a list")
		return
	}
	s := config.Current()
	maxOps := 100
	if (s != nil) && (s.MaxBatchOperations > 0) {
		maxOps = s.MaxBatchOperations
	}
	if len(opsList) > maxOps {
		httphelper.JSONBadRequest(w, "operations exceeds limit")
		return
	}
	ops := []map[string]any{}
	for _, item := range opsList {
		m, mok := item.(map[string]any)
		if !mok {
			httphelper.JSONBadRequest(w, "each operation must be an object")
			return
		}
		ops = append(ops, m)
	}
	checkRequired := true
	if v, vok := body["check_required_fields"]; vok {
		if b, bok := v.(bool); bok {
			checkRequired = b
		}
	}
	results, successful, failed := batchsvc.ExecuteOperations(ops, checkRequired)
	status := "success"
	if failed > 0 {
		status = "partial"
	}
	log.Info(fmt.Sprintf("Batch operations: %v ok, %v failed", successful, failed))
	httphelper.JSON(w, map[string]any{"status": status, "results": results, "successful": successful, "failed": failed})
}

func Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/batch/operations", executeOps)
}
