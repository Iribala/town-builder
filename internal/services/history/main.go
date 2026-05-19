package history

import (
	"fmt"
	"github.com/duber000/town-builder/internal/config"
	"github.com/duber000/town-builder/internal/storage"
	"github.com/google/uuid"
	ctxpkg "github.com/kukichalang/kukicha/stdlib/ctx"
	"github.com/kukichalang/kukicha/stdlib/json"
	"github.com/kukichalang/kukicha/stdlib/log"
	redis "github.com/redis/go-redis/v9"
	"sync"
	"time"
)

const historyKey = "town_history"

const redoKey = "town_redo"

const redisTimeoutNanos = 2_000_000_000

var lock sync.Mutex

var historyStack []map[string]any

var redoStack []map[string]any

func init() {
	historyStack = []map[string]any{}
	redoStack = []map[string]any{}
}

func maxSize() int {
	s := config.Current()
	if s == nil {
		return 100
	}
	return s.MaxHistorySize
}

func newCtx() ctxpkg.Handle {
	return ctxpkg.WithTimeout(ctxpkg.Background(), redisTimeoutNanos)
}

func appendCapped(stack []map[string]any, entry map[string]any, cap int) []map[string]any {
	stack = append(stack, entry)
	if len(stack) > cap {
		stack = stack[(len(stack) - cap):]
	}
	return stack
}

func AddEntry(operation string, category string, objectID string, before map[string]any, after map[string]any) (string, error) {
	entryID := uuid.New().String()
	entry := make(map[string]any)
	entry["id"] = entryID
	entry["timestamp"] = (float64(time.Now().UnixNano()) / 1000000000.0)
	entry["operation"] = operation
	entry["category"] = category
	entry["object_id"] = objectID
	entry["before_state"] = before
	entry["after_state"] = after
	client := storage.Client()
	if client != nil {
		data, err := json.Bytes(entry)
		if err == nil {
			h := newCtx()
			defer h.Cancel()
			rerr := client.RPush(h.Ctx, historyKey, data).Err()
			if rerr == nil {
				length, lerr := client.LLen(h.Ctx, historyKey).Result()
				if (lerr == nil) && (length > int64(maxSize())) {
					client.LTrim(h.Ctx, historyKey, -int64(maxSize()), -1)
				}
				client.Del(h.Ctx, redoKey)
				log.Info(fmt.Sprintf("Added history entry: %v on %v/%v", operation, category, objectID))
				return entryID, nil
			}
			log.Warn(fmt.Sprintf("Redis history add failed, using in-memory storage: %v", rerr))
		}
	}
	lock.Lock()
	historyStack = appendCapped(historyStack, entry, maxSize())
	redoStack = []map[string]any{}
	lock.Unlock()
	log.Info(fmt.Sprintf("Added history entry: %v on %v/%v", operation, category, objectID))
	return entryID, nil
}

func GetHistory(limit int) []map[string]any {
	client := storage.Client()
	if client != nil {
		h := newCtx()
		defer h.Cancel()
		entries, err := client.LRange(h.Ctx, historyKey, -int64(limit), -1).Result()
		if err == nil {
			out := []map[string]any{}
			{
				_iStart, _iEnd, _iStep := (len(entries) - 1), 0, 1
				if _iStart > _iEnd {
					_iStep = -1
				}
				for i := _iStart; i != _iEnd+_iStep; i += _iStep {
					obj := make(map[string]any)
					perr := json.ParseInto([]byte(entries[i]), &obj)
					if perr == nil {
						out = append(out, obj)
					}
				}
			}
			return out
		}
		log.Warn(fmt.Sprintf("Redis history get failed, using in-memory storage: %v", err))
	}
	lock.Lock()
	defer lock.Unlock()
	start := (len(historyStack) - limit)
	if start < 0 {
		start = 0
	}
	src := historyStack[start:]
	out := []map[string]any{}
	{
		_iStart, _iEnd, _iStep := (len(src) - 1), 0, 1
		if _iStart > _iEnd {
			_iStep = -1
		}
		for i := _iStart; i != _iEnd+_iStep; i += _iStep {
			out = append(out, src[i])
		}
	}
	return out
}

func CanUndo() bool {
	client := storage.Client()
	if client != nil {
		h := newCtx()
		defer h.Cancel()
		n, err := client.LLen(h.Ctx, historyKey).Result()
		if err == nil {
			return (n > 0)
		}
	}
	lock.Lock()
	defer lock.Unlock()
	return (len(historyStack) > 0)
}

func CanRedo() bool {
	client := storage.Client()
	if client != nil {
		h := newCtx()
		defer h.Cancel()
		n, err := client.LLen(h.Ctx, redoKey).Result()
		if err == nil {
			return (n > 0)
		}
	}
	lock.Lock()
	defer lock.Unlock()
	return (len(redoStack) > 0)
}

func GetLastEntry() (map[string]any, bool) {
	client := storage.Client()
	if client != nil {
		h := newCtx()
		defer h.Cancel()
		entry, err := client.LIndex(h.Ctx, historyKey, -1).Result()
		if (err == nil) && (entry != "") {
			obj := make(map[string]any)
			perr := json.ParseInto([]byte(entry), &obj)
			if perr == nil {
				return obj, true
			}
		} else if (err != nil) && (err != redis.Nil) {
			log.Warn(fmt.Sprintf("Redis get last entry failed: %v", err))
		}
	}
	lock.Lock()
	defer lock.Unlock()
	if len(historyStack) == 0 {
		return nil, false
	}
	return historyStack[(len(historyStack) - 1)], true
}

func PopLastEntry() (map[string]any, bool) {
	client := storage.Client()
	if client != nil {
		h := newCtx()
		defer h.Cancel()
		entry, err := client.RPop(h.Ctx, historyKey).Result()
		if (err == nil) && (entry != "") {
			obj := make(map[string]any)
			perr := json.ParseInto([]byte(entry), &obj)
			if perr == nil {
				return obj, true
			}
		} else if (err != nil) && (err != redis.Nil) {
			log.Warn(fmt.Sprintf("Redis pop failed, using in-memory storage: %v", err))
		}
	}
	lock.Lock()
	defer lock.Unlock()
	if len(historyStack) == 0 {
		return nil, false
	}
	entry := historyStack[(len(historyStack) - 1)]
	historyStack = historyStack[:(len(historyStack) - 1)]
	return entry, true
}

func PushRedoEntry(entry map[string]any) {
	client := storage.Client()
	if client != nil {
		data, err := json.Bytes(entry)
		if err == nil {
			h := newCtx()
			defer h.Cancel()
			rerr := client.RPush(h.Ctx, redoKey, data).Err()
			if rerr == nil {
				length, lerr := client.LLen(h.Ctx, redoKey).Result()
				if (lerr == nil) && (length > int64(maxSize())) {
					client.LTrim(h.Ctx, redoKey, -int64(maxSize()), -1)
				}
				return
			}
			log.Warn(fmt.Sprintf("Redis redo push failed, using in-memory storage: %v", rerr))
		}
	}
	lock.Lock()
	redoStack = appendCapped(redoStack, entry, maxSize())
	lock.Unlock()
}

func PopRedoEntry() (map[string]any, bool) {
	client := storage.Client()
	if client != nil {
		h := newCtx()
		defer h.Cancel()
		entry, err := client.RPop(h.Ctx, redoKey).Result()
		if (err == nil) && (entry != "") {
			obj := make(map[string]any)
			perr := json.ParseInto([]byte(entry), &obj)
			if perr == nil {
				return obj, true
			}
		} else if (err != nil) && (err != redis.Nil) {
			log.Warn(fmt.Sprintf("Redis redo pop failed, using in-memory storage: %v", err))
		}
	}
	lock.Lock()
	defer lock.Unlock()
	if len(redoStack) == 0 {
		return nil, false
	}
	entry := redoStack[(len(redoStack) - 1)]
	redoStack = redoStack[:(len(redoStack) - 1)]
	return entry, true
}

func ClearHistory() {
	client := storage.Client()
	if client != nil {
		h := newCtx()
		defer h.Cancel()
		client.Del(h.Ctx, historyKey)
		client.Del(h.Ctx, redoKey)
	}
	lock.Lock()
	historyStack = []map[string]any{}
	redoStack = []map[string]any{}
	lock.Unlock()
	log.Info("History cleared")
}
