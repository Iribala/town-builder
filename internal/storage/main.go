package storage

import (
	"fmt"
	"github.com/duber000/town-builder/internal/normalization"
	"github.com/klauspost/compress/zstd"
	ctxpkg "github.com/kukichalang/kukicha/stdlib/ctx"
	"github.com/kukichalang/kukicha/stdlib/json"
	"github.com/kukichalang/kukicha/stdlib/log"
	redis "github.com/redis/go-redis/v9"
	"sync"
)

const townKey = "town_data"

const redisTimeoutNanos = 2_000_000_000

var client *redis.Client

var lock sync.RWMutex

var memory map[string]any

var encoder *zstd.Encoder

var decoder *zstd.Decoder

func defaultTownData() map[string]any {
	out := make(map[string]any)
	for _, cat := range normalization.Categories {
		out[cat] = []map[string]any{}
	}
	return out
}

func init() {
	memory = defaultTownData()
	enc, err := zstd.NewWriter(nil)
	if err == nil {
		encoder = enc
	}
	dec, err2 := zstd.NewReader(nil)
	if err2 == nil {
		decoder = dec
	}
}

func Initialize(redisURL string) error {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Warn(fmt.Sprintf("Redis URL parse failed, using in-memory storage: %v", err))
		return nil
	}
	c := redis.NewClient(opts)
	h := ctxpkg.WithTimeout(ctxpkg.Background(), redisTimeoutNanos)
	defer h.Cancel()
	_, perr := c.Ping(h.Ctx).Result()
	if perr != nil {
		log.Warn(fmt.Sprintf("Redis ping failed, using in-memory storage: %v", perr))
		return nil
	}
	client = c
	log.Info("Redis client initialized successfully")
	return nil
}

func Close() error {
	if client != nil {
		err := client.Close()
		client = nil
		return err
	}
	return nil
}

func deepCopyMap(src map[string]any) map[string]any {
	data, err := json.Bytes(src)
	if err != nil {
		return defaultTownData()
	}
	out := make(map[string]any)
	perr := json.ParseInto(data, &out)
	if perr != nil {
		return defaultTownData()
	}
	return out
}

func snapshotMemory() map[string]any {
	lock.RLock()
	defer lock.RUnlock()
	return deepCopyMap(memory)
}

func Get() (map[string]any, error) {
	if (client != nil) && (decoder != nil) {
		h := ctxpkg.WithTimeout(ctxpkg.Background(), redisTimeoutNanos)
		defer h.Cancel()
		data, err := client.Get(h.Ctx, townKey).Bytes()
		if err == nil {
			decompressed, derr := decoder.DecodeAll(data, nil)
			if derr != nil {
				log.Warn(fmt.Sprintf("Failed to decompress town data: %v", derr))
				return snapshotMemory(), nil
			}
			out := make(map[string]any)
			perr := json.ParseInto(decompressed, &out)
			if perr != nil {
				log.Warn(fmt.Sprintf("Failed to parse stored town data: %v", perr))
				return snapshotMemory(), nil
			}
			return out, nil
		} else if err != redis.Nil {
			log.Warn(fmt.Sprintf("Redis get failed, using in-memory storage: %v", err))
		}
	}
	return snapshotMemory(), nil
}

func Set(data map[string]any) error {
	lock.Lock()
	memory = deepCopyMap(data)
	lock.Unlock()
	if (client != nil) && (encoder != nil) {
		raw, err := json.Bytes(data)
		if err != nil {
			log.Warn(fmt.Sprintf("Town data serialize failed: %v", err))
			return nil
		}
		compressed := encoder.EncodeAll(raw, nil)
		h := ctxpkg.WithTimeout(ctxpkg.Background(), redisTimeoutNanos)
		defer h.Cancel()
		serr := client.Set(h.Ctx, townKey, compressed, 0).Err()
		if serr != nil {
			log.Warn(fmt.Sprintf("Redis set failed, data saved to memory only: %v", serr))
		}
	}
	return nil
}

func ResetMemory() {
	lock.Lock()
	defer lock.Unlock()
	memory = defaultTownData()
}

func SetClient(c *redis.Client) {
	client = c
}

func Client() *redis.Client {
	return client
}
