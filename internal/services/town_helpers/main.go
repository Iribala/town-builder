package town_helpers

import (
	"fmt"
	"github.com/duber000/town-builder/internal/config"
	"github.com/duber000/town-builder/internal/storage"
	ctxpkg "github.com/kukichalang/kukicha/stdlib/ctx"
	"github.com/kukichalang/kukicha/stdlib/json"
	"github.com/kukichalang/kukicha/stdlib/log"
)

const publishTimeoutNanos = 2_000_000_000

func BroadcastSSE(event map[string]any) {
	client := storage.Client()
	if client == nil {
		return
	}
	s := config.Current()
	if s == nil {
		return
	}
	msg, err := json.Bytes(event)
	if err != nil {
		log.Warn(fmt.Sprintf("Failed to encode SSE event: %v", err))
		return
	}
	h := ctxpkg.WithTimeout(ctxpkg.Background(), publishTimeoutNanos)
	defer h.Cancel()
	perr := client.Publish(h.Ctx, s.PubsubChannel, msg).Err()
	if perr != nil {
		log.Warn(fmt.Sprintf("Failed to broadcast SSE event (Redis unavailable): %v", perr))
	}
}

func SaveAndBroadcast(townData map[string]any, event map[string]any) error {
	err := storage.Set(townData)
	if err != nil {
		return err
	}
	BroadcastSSE(event)
	return nil
}
