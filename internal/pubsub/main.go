package pubsub

import (
	"fmt"
	"github.com/duber000/town-builder/internal/config"
	"github.com/duber000/town-builder/internal/storage"
	ctxpkg "github.com/kukichalang/kukicha/stdlib/ctx"
	"github.com/kukichalang/kukicha/stdlib/log"
	redis "github.com/redis/go-redis/v9"
	"sync"
	"time"
)

const subscribeTimeoutNanos = 2_000_000_000

var presLock sync.Mutex

var connectedUsers map[string]int64

var userCounts map[string]int

func init() {
	connectedUsers = make(map[string]int64)
	userCounts = make(map[string]int)
}

func nowNanos() int64 {
	return time.Now().UnixNano()
}

func activityTimeoutNanos() int64 {
	s := config.Current()
	if s == nil {
		return int64(30_000_000_000)
	}
	return int64((s.UserActivityTimeout * 1_000_000_000.0))
}

func cleanupLocked() {
	cutoff := (nowNanos() - activityTimeoutNanos())
	stale := []string{}
	for name := range connectedUsers {
		if connectedUsers[name] < cutoff {
			stale = append(stale, name)
		}
	}
	for _, name := range stale {
		delete(connectedUsers, name)
		delete(userCounts, name)
	}
}

func usersLocked() []string {
	out := []string{}
	for name := range connectedUsers {
		out = append(out, name)
	}
	return out
}

func CanConnect(name string) bool {
	if name == "" {
		return true
	}
	s := config.Current()
	limit := 3
	if s != nil {
		limit = s.MaxSseConnectionsPerUser
	}
	presLock.Lock()
	defer presLock.Unlock()
	if userCounts[name] >= limit {
		log.Warn(fmt.Sprintf("SSE connection limit (%v) reached for user: %v", limit, name))
		return false
	}
	userCounts[name] = (userCounts[name] + 1)
	connectedUsers[name] = nowNanos()
	return true
}

func Disconnect(name string) {
	if name == "" {
		return
	}
	presLock.Lock()
	defer presLock.Unlock()
	count := (userCounts[name] - 1)
	if count <= 0 {
		delete(userCounts, name)
		delete(connectedUsers, name)
	} else {
		userCounts[name] = count
	}
}

func Touch(name string) {
	if name == "" {
		return
	}
	presLock.Lock()
	defer presLock.Unlock()
	if _, ok := userCounts[name]; ok {
		connectedUsers[name] = nowNanos()
	}
}

func OnlineUsers() []string {
	presLock.Lock()
	defer presLock.Unlock()
	cleanupLocked()
	return usersLocked()
}

func Subscribe() (chan string, func()) {
	client := storage.Client()
	if client == nil {
		return nil, nil
	}
	s := config.Current()
	if s == nil {
		return nil, nil
	}
	h := ctxpkg.WithTimeout(ctxpkg.Background(), subscribeTimeoutNanos)
	defer h.Cancel()
	sub := client.Subscribe(h.Ctx, s.PubsubChannel)
	out := make(chan string)
	stop := make(chan bool)
	go pump(sub, out, stop)
	cancel := func() {
		close(stop)
	}
	return out, cancel
}

func closeStringChan(ch chan string) {
	close(ch)
}

func pump(sub *redis.PubSub, out chan string, stop chan bool) {
	defer sub.Close()
	defer closeStringChan(out)
	msgs := sub.Channel()
	for {
		select {
		case <-stop:
			return
		case msg := <-msgs:
			if msg == nil {
				return
			}
			select {
			case out <- msg.Payload:
			case <-stop:
				return
			}
		}
	}
}
