package snapshots

import (
	"fmt"
	"github.com/duber000/town-builder/internal/config"
	"github.com/duber000/town-builder/internal/storage"
	"github.com/google/uuid"
	"github.com/klauspost/compress/zstd"
	ctxpkg "github.com/kukichalang/kukicha/stdlib/ctx"
	"github.com/kukichalang/kukicha/stdlib/json"
	"github.com/kukichalang/kukicha/stdlib/log"
	redis "github.com/redis/go-redis/v9"
	"sync"
	"time"
)

const snapshotsKey = "town_snapshots"

const snapshotDataPrefix = "town_snapshot:"

const redisTimeoutNanos = 2_000_000_000

var snapshotCategories = []string{"buildings", "terrain", "roads", "props", "vehicles", "trees", "park"}

var memLock sync.Mutex

var memSnapshots []map[string]any

var memSnapshotData map[string]map[string]any

var encoder *zstd.Encoder

var decoder *zstd.Decoder

func init() {
	memSnapshots = []map[string]any{}
	memSnapshotData = make(map[string]map[string]any)
	enc, err := zstd.NewWriter(nil)
	if err == nil {
		encoder = enc
	}
	dec, err2 := zstd.NewReader(nil)
	if err2 == nil {
		decoder = dec
	}
}

func maxSnapshots() int {
	s := config.Current()
	if s == nil {
		return 50
	}
	return s.MaxSnapshots
}

func countObjects(townData map[string]any) int {
	total := 0
	for _, cat := range snapshotCategories {
		v, ok := townData[cat]
		if !ok {
			continue
		}
		lst, lok := v.([]any)
		if lok {
			total = (total + len(lst))
		}
	}
	return total
}

func CreateSnapshot(townData map[string]any, name string, description string) (string, error) {
	snapshotID := uuid.NewString()
	timestamp := (float64(time.Now().UnixNano()) / 1000000000.0)
	metadata := make(map[string]any)
	metadata["id"] = snapshotID
	if name == "" {
		name = ("Snapshot " + time.Now().Format("2006-01-02 15:04:05"))
	}
	metadata["name"] = name
	metadata["description"] = description
	metadata["timestamp"] = timestamp
	metadata["size"] = countObjects(townData)
	client := storage.Client()
	if (client == nil) || (encoder == nil) {
		log.Warn("Redis unavailable; storing snapshot in memory (not persistent)")
		memLock.Lock()
		defer memLock.Unlock()
		if len(memSnapshots) == maxSnapshots() {
			oldest := memSnapshots[0]
			if oid, ok := oldest["id"].(string); ok {
				delete(memSnapshotData, oid)
			}
			memSnapshots = memSnapshots[1:]
		}
		memSnapshots = append(memSnapshots, metadata)
		memSnapshotData[snapshotID] = townData
		log.Info(fmt.Sprintf("Created in-memory snapshot: %v (%v)", snapshotID, name))
		return snapshotID, nil
	}
	raw, err := json.Bytes(townData)
	if err != nil {
		return "", err
	}
	compressed := encoder.EncodeAll(raw, nil)
	h := ctxpkg.WithTimeout(ctxpkg.Background(), redisTimeoutNanos)
	defer h.Cancel()
	dataKey := (snapshotDataPrefix + snapshotID)
	serr := client.Set(h.Ctx, dataKey, compressed, 0).Err()
	if serr != nil {
		return "", serr
	}
	metaBytes, merr := json.Bytes(metadata)
	if merr != nil {
		return "", merr
	}
	rerr := client.RPush(h.Ctx, snapshotsKey, metaBytes).Err()
	if rerr != nil {
		return "", rerr
	}
	length, lerr := client.LLen(h.Ctx, snapshotsKey).Result()
	if (lerr == nil) && (length > int64(maxSnapshots())) {
		oldestEntry, oerr := client.LIndex(h.Ctx, snapshotsKey, 0).Result()
		if (oerr == nil) && (oldestEntry != "") {
			oldestMeta := make(map[string]any)
			perr := json.ParseInto([]byte(oldestEntry), &oldestMeta)
			if perr == nil {
				if oid, ok := oldestMeta["id"].(string); ok {
					client.Del(h.Ctx, (snapshotDataPrefix + oid))
				}
			}
		}
		client.LTrim(h.Ctx, snapshotsKey, -int64(maxSnapshots()), -1)
	}
	log.Info(fmt.Sprintf("Created snapshot: %v (%v)", snapshotID, name))
	return snapshotID, nil
}

func ListSnapshots() []map[string]any {
	client := storage.Client()
	if client == nil {
		memLock.Lock()
		defer memLock.Unlock()
		out := []map[string]any{}
		{
			_iStart, _iEnd, _iStep := (len(memSnapshots) - 1), 0, 1
			if _iStart > _iEnd {
				_iStep = -1
			}
			for i := _iStart; i != _iEnd+_iStep; i += _iStep {
				out = append(out, memSnapshots[i])
			}
		}
		return out
	}
	h := ctxpkg.WithTimeout(ctxpkg.Background(), redisTimeoutNanos)
	defer h.Cancel()
	entries, err := client.LRange(h.Ctx, snapshotsKey, 0, -1).Result()
	if err != nil {
		log.Error(fmt.Sprintf("Failed to list snapshots: %v", err))
		return []map[string]any{}
	}
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

func GetSnapshot(snapshotID string) (map[string]any, bool) {
	client := storage.Client()
	if (client == nil) || (decoder == nil) {
		memLock.Lock()
		defer memLock.Unlock()
		v, ok := memSnapshotData[snapshotID]
		return v, ok
	}
	h := ctxpkg.WithTimeout(ctxpkg.Background(), redisTimeoutNanos)
	defer h.Cancel()
	dataKey := (snapshotDataPrefix + snapshotID)
	data, err := client.Get(h.Ctx, dataKey).Bytes()
	if err != nil {
		if err != redis.Nil {
			log.Error(fmt.Sprintf("Failed to get snapshot %v: %v", snapshotID, err))
		}
		return nil, false
	}
	decompressed, derr := decoder.DecodeAll(data, nil)
	if derr != nil {
		log.Error(fmt.Sprintf("Failed to decompress snapshot %v: %v", snapshotID, derr))
		return nil, false
	}
	obj := make(map[string]any)
	perr := json.ParseInto(decompressed, &obj)
	if perr != nil {
		return nil, false
	}
	return obj, true
}

func DeleteSnapshot(snapshotID string) bool {
	client := storage.Client()
	if client == nil {
		memLock.Lock()
		defer memLock.Unlock()
		before := len(memSnapshots)
		kept := []map[string]any{}
		for _, s := range memSnapshots {
			if id, ok := s["id"].(string); ok && (id == snapshotID) {
				continue
			}
			kept = append(kept, s)
		}
		memSnapshots = kept
		delete(memSnapshotData, snapshotID)
		return (len(memSnapshots) < before)
	}
	h := ctxpkg.WithTimeout(ctxpkg.Background(), redisTimeoutNanos)
	defer h.Cancel()
	dataKey := (snapshotDataPrefix + snapshotID)
	deletedCount, _ := client.Del(h.Ctx, dataKey).Result()
	entries, err := client.LRange(h.Ctx, snapshotsKey, 0, -1).Result()
	if err != nil {
		log.Error(fmt.Sprintf("Failed to delete snapshot %v: %v", snapshotID, err))
		return false
	}
	newEntries := []any{}
	for _, entry := range entries {
		meta := make(map[string]any)
		perr := json.ParseInto([]byte(entry), &meta)
		if perr != nil {
			newEntries = append(newEntries, entry)
			continue
		}
		if id, ok := meta["id"].(string); ok && (id == snapshotID) {
			continue
		}
		newEntries = append(newEntries, entry)
	}
	foundInList := (len(newEntries) < len(entries))
	client.Del(h.Ctx, snapshotsKey)
	if len(newEntries) > 0 {
		client.RPush(h.Ctx, snapshotsKey, newEntries...)
	}
	if (deletedCount > 0) || foundInList {
		log.Info(fmt.Sprintf("Deleted snapshot: %v", snapshotID))
		return true
	}
	log.Warn(fmt.Sprintf("Snapshot not found: %v", snapshotID))
	return false
}

func GetSnapshotMetadata(snapshotID string) (map[string]any, bool) {
	client := storage.Client()
	if client == nil {
		memLock.Lock()
		defer memLock.Unlock()
		for _, s := range memSnapshots {
			if id, ok := s["id"].(string); ok && (id == snapshotID) {
				return s, true
			}
		}
		return nil, false
	}
	h := ctxpkg.WithTimeout(ctxpkg.Background(), redisTimeoutNanos)
	defer h.Cancel()
	entries, err := client.LRange(h.Ctx, snapshotsKey, 0, -1).Result()
	if err != nil {
		log.Error(fmt.Sprintf("Failed to get snapshot metadata %v: %v", snapshotID, err))
		return nil, false
	}
	for _, entry := range entries {
		meta := make(map[string]any)
		perr := json.ParseInto([]byte(entry), &meta)
		if perr != nil {
			continue
		}
		if id, ok := meta["id"].(string); ok && (id == snapshotID) {
			return meta, true
		}
	}
	return nil, false
}
