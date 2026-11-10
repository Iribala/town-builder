---
type: Agent Instructions
title: AGENTS.md — town-builder repository guide
description: Architecture, commands, and WASM build constraints for agents working in town-builder.
tags: [agents, conventions, kukicha, threejs, wasm, town-builder, multiplayer]
generated: { by: antigravity/gemini-3.8-flash, at: 2026-09-26T12:55:00-04:00 }
verified:
stale_after: 2026-12-26T00:00:00Z
status: stable
sources:
  - id: repo-tree
    resource: /
    title: Repository source tree
---

# Town Builder

## Commands

```bash
# Type check all packages
kukicha check ./...

# Format check
kukicha fmt --check --json .

# Auto-format
kukicha fmt -w .

# Build WASM game module (WASM target required due to syscall/js)
GOOS=js GOARCH=wasm kukicha build .

# Install Go dependencies
go mod download

# Development server (port 5001)
go run ./cmd/server
# or
./scripts/dev.sh

# Production server (compiled binary)
./scripts/prod.sh

# Run all tests
go test ./...

# Run a single test
go test ./internal/routes/town/... -run TestSaveTownPatches

# Rebuild physics WASM (only after editing physics_wasm.kuki)
kukicha brew --stdout --build-tag "js && wasm" physics_wasm.kuki > physics_wasm.go
./build_wasm.sh
```

## Local multiplayer & Redis

Redis is optional for a single-tab smoke test but **required for anything
multiplayer**, and the degraded mode is silent:

- `storage.Initialize()` pings Redis **once at server startup** and never
  retries. If Redis is down when the server starts (or appears later),
  storage stays in-memory and `pubsub.Subscribe()` returns nothing, so SSE
  connections run in "keepalive-only" mode: no cursor, edit, delete, or
  snapshot events are ever fanned out — while every API POST still
  returns 200 and pages load fine.
- Symptom: two tabs both render and the Users panel looks alive at connect
  time, but nothing placed, moved, or deleted in one tab appears in the
  other. Only trace is a `WARN … keepalive-only mode` in the server log at
  SSE connect time.
- Fix: `redis-server`, then **restart the dev server** — it will not
  re-probe Redis on its own. `scripts/dev.sh` warns if Redis is missing but
  does not restart the server for you. `redis-cli ping` to check;
  `redis-cli monitor` to watch `town_events` fan-out.

## Architecture

Town Builder is a real-time multiplayer 3D town builder. Three layers communicate:

- **Backend** – Kukicha (transpiled to Go, `net/http.ServeMux` + Go 1.22 method patterns) following a strict `Routes → Services → Storage` layering. Routes handle HTTP; services hold all business logic; `internal/storage/` abstracts Redis (primary) with an in-memory map fallback when Redis is unavailable. Sources live in `*.kuki` files; brewed `.go` files are committed alongside so `go test` / `go build` work without a build step.
- **Frontend** – Vanilla JavaScript + Three.js (no framework). `static/js/scene.js` is the central orchestrator; `static/js/ui.js` handles DOM events; `static/js/network.js` manages SSE reconnection.
- **Physics WASM** – `physics_wasm.kuki` brews to `physics_wasm.go` and compiles to `static/wasm/physics_greentea.wasm`. Exposes a spatial-grid collision system and car physics as global JS functions (`wasmUpdateSpatialGrid`, `wasmCheckCollision`, `wasmBatchCheckCollisions`, `wasmUpdateCarPhysics`, etc.). WASM loading is non-critical; the app degrades gracefully if it fails.

**Multiplayer flow:** client POST → backend saves to Redis → publishes to Redis Pub/Sub channel `town_events` → SSE endpoint (`GET /events`) fans out to connected clients.

## Key Conventions

### Layout data normalization
Town data arrives in two shapes (map-of-categories or list-of-objects). Always pass it through `internal/normalization.NormalizeLayoutData()` before use. The canonical category list lives in `internal/normalization.Categories`.

### Adding a new API endpoint
1. Define request/response types in `internal/models/schemas.kuki`.
2. Implement logic in a new `internal/services/<name>/<name>.kuki`.
3. Create route handler in `internal/routes/<name>/<name>.kuki`.
4. Register the route in `internal/routes/router/router.kuki`.

After editing any `.kuki` file, brew the `.go` next to it (see `docs/plans/kukicha-port.md` "Build pipeline" section).

### Configuration
`internal/config/config.kuki` reads settings from the process environment via `env.GetOr`/`env.GetBoolOrDefault` (`os.Getenv` under the hood). The server loads `.env` at startup: `cmd/server/main()` calls `config.LoadEnvFile(".env")` before `config.Load()`. The loader parses `KEY=VALUE` lines (skips `#` comments/blank lines, strips surrounding quotes, splits on the first `=`) and `os.Setenv`s each — **without overriding variables already in the environment** (shell/container wins; `.env` only fills gaps, like `godotenv.Load`). So real env vars (e.g. Kubernetes-injected secrets) always take precedence. `config.Load()` itself stays a pure reader so `config.SetForTest` tests are unaffected. Key variables:
- `DISABLE_JWT_AUTH=true` – bypass auth in development/tests.
- `JWT_SECRET_KEY` – required when `DISABLE_JWT_AUTH` is not `true` (the server FATALs otherwise).
- `ALLOWED_ORIGINS` – comma-separated CORS origins; defaults to localhost in development if empty.
- `ROOT_PATH` – reverse-proxy path prefix for template URL generation.

### Security utilities
Use `internal/utils/security/` for any new file path operations (path-traversal prevention) or outbound HTTP calls (SSRF prevention). Allowed external domains are controlled by `settings.AllowedApiDomains`.

### Testing
- Tests live next to their subject as `<name>_test.kuki` (brewed to `<name>_test.go`); run with `go test ./internal/...`.
- `config.SetForTest(s)` injects settings; `storage.SetClient(empty)` + `storage.ResetMemory()` give a clean in-memory store.
- `httptest.NewServer` against `router.NewMux()` is the standard pattern for route integration tests.
- Mock external Django API calls with `httptest.NewServer` returning canned JSON.
- Frontend JS tests are `node:test` files in `tests/js/` (`*.test.cjs`); run with `./scripts/test-js.sh` (or `node --test tests/js/`). They evaluate the real ES-module sources in a `node:vm` sandbox with stubbed DOM/Three.js dependencies, so no browser or bundler is needed. Adding an import to `static/js/network.js` or `static/js/utils/town-layout.js` requires a matching stub in `createHarness()`.

### Commit messages
Follow Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

### WASM output file & build gotchas
- The physics module outputs to `static/wasm/physics_greentea.wasm` (not `physics.wasm`).
- **WASM Build Constraints**: Direct `kukicha build .` without `GOOS=js GOARCH=wasm` fails with `imports syscall/js: build constraints exclude all Go files...`. Always build with `GOOS=js GOARCH=wasm kukicha build .`.
- **Artifact Cleanup**: A directory build creates `./town-builder` and `main.go` in the repository root. Delete these artifacts after test builds.

<!-- kukicha:start -->
# Kukicha

Kukicha is a readable, statically typed language that transpiles to Go — same toolchain, modules, and semantics — with pipes, `onerr`, enums, if-expressions, and English operators instead of Go's C-style symbol load. This project is a Kukicha project — compile and run `.kuki` files with the `kukicha` compiler (v0.86.7).

The full language + stdlib reference is installed as the `kukicha` skill at [.agents/skills/kukicha/SKILL.md](.agents/skills/kukicha/SKILL.md) — read it before writing or reviewing `.kuki` code. It is compiler-owned and regenerated by `kukicha init` (or the first build after a compiler upgrade); don't hand-edit it.

<!-- kukicha:end -->
