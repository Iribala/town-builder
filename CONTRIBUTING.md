# Contributing to Town Builder

Town Builder is a Kukicha codebase (sources in `*.kuki`, brewed `.go` committed alongside). This guide assumes you already know Kukicha — for syntax, stdlib, gotchas, and the kukicha CLI see [`.claude/skills/kukicha/SKILL.md`](.claude/skills/kukicha/SKILL.md).

## Setup

- **Go 1.26+** — required to compile and test
- **Kukicha** — only needed if you edit `.kuki` sources; brewed `.go` is committed so `go test` / `go build` work without it
- **Redis** — required for multiplayer; in-memory fallback keeps the server up if it's missing

```bash
git clone <repo>
cd town-builder
./scripts/setup.sh    # Go check, optional Kukicha check, Redis check, .env from template
go run ./cmd/server   # http://127.0.0.1:5001
go test ./...
```

## Project layout

```
cmd/server/main.kuki        # HTTP server bootstrap
internal/
├── config/                 # Settings + SetForTest helper
├── models/schemas.kuki     # Request/response value types
├── normalization/          # Layout-data shape coercion
├── storage/                # Redis primary + in-memory fallback
├── pubsub/                 # Redis Pub/Sub for SSE fan-out
├── middleware/{bodylimit,cors}/
├── routes/<name>/          # HTTP handlers (one petiole per dir)
├── services/<name>/        # Business logic (one petiole per dir)
└── utils/{geometry,security}/
physics_wasm.kuki           # Brews to physics_wasm.go (//go:build js && wasm)
static/, templates/, k8s/, docs/
```

## The two-file invariant

Every `*.kuki` source has a brewed `*.go` next to it, both committed. This is what lets `go test ./...` and `go build ./cmd/server` work for contributors who don't have the kukicha CLI installed.

**When you edit a `.kuki` file, refresh its `.go`:**

```bash
kukicha check internal/foo/foo.kuki                           # fastest validation
kukicha brew --stdout internal/foo/foo.kuki > internal/foo/main.go   # refresh brewed output
go build ./...                                                # final cross-package check
```

For `_test.kuki` files the brewed target is `internal/foo/foo_test.go` (not `main.go`). Directory-mode `kukicha brew internal/foo/` is unreliable — prefer the explicit `--stdout > target` form. See the "Edit loop for this project" block in the skill for more.

**Do not** hand-edit the brewed `.go`. If they ever drift, re-brew from the `.kuki` source.

## Project conventions

These are the non-obvious rules the codebase relies on. Most one-off lookups can be answered by `kukicha context <dir>` (top-level decls + imports) plus reading the relevant source.

### Layered architecture — `routes → services → storage`
Routes parse HTTP, validate, and shape responses. Services hold all business logic. Storage is accessed only via `internal/storage/` (Redis + in-memory fallback). Routes that talk to storage directly are a code smell.

### Normalization
Town layout data arrives in two shapes (map-of-categories or list-of-objects). Always pass it through `internal/normalization.NormalizeLayoutData()` before use. The canonical category list lives at `internal/normalization.Categories`.

### Security utilities
Any new code that touches the filesystem (path-traversal risk) or makes outbound HTTP calls (SSRF risk) must go through `internal/utils/security/`. The allowlist for external domains is `settings.AllowedApiDomains`.

### Config injection in tests
Use `config.SetForTest(s)` to inject a `*Settings` for the test. Pair it with `storage.SetClient(empty)` + `storage.ResetMemory()` for a clean in-memory store. See `internal/services/batch/batch_test.kuki` for the canonical setup.

### Multiplayer flow
Client POST → `internal/storage` writes → `internal/pubsub` publishes on Redis channel `town_events` → `internal/routes/events` (SSE) fans out. Don't bypass pubsub for cross-client updates.

### `httptest.NewServer` is the route-test pattern
Spin up a real `router.NewMux()` against `httptest.NewServer`, hit it with `httptest.NewRequest` / `httptest.NewRecorder`. Bare `func(w, r)` literals auto-wrap to `http.HandlerFunc` (kukicha v0.19.5+). See `internal/routes/proxy/proxy_test.kuki` for a representative example, including the SSRF-protection test cases.

### WASM physics
`physics_wasm.kuki` is the source of truth. Brewed output needs the build tag swapped (kukicha emits `//go:build ignore`, WASM needs `//go:build js && wasm`):

```bash
kukicha brew --stdout physics_wasm.kuki > physics_wasm.go
sed -i 's|^//go:build ignore$|//go:build js \&\& wasm|' physics_wasm.go
./build_wasm.sh    # produces static/wasm/physics_greentea.wasm
```

Frontend treats WASM loading as non-critical — it degrades gracefully if `static/wasm/physics_greentea.wasm` fails to load.

### Adding a new HTTP endpoint
1. Add request/response types to `internal/models/schemas.kuki`.
2. Implement the logic in `internal/services/<name>/<name>.kuki`.
3. Add the handler in `internal/routes/<name>/<name>.kuki`.
4. Register on the mux in `internal/routes/router/router.kuki`.
5. Brew each touched `.kuki` to refresh its `.go`.
6. Add a `<name>_test.kuki` next to the handler (route-level) and one next to the service (unit-level).

## Commits & PRs

- Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`).
- Keep brewed `.go` files in the same commit as their `.kuki` source.
- Run `go test ./...` and `go build ./...` before pushing.
- For UI changes, start `./scripts/dev.sh` and exercise the feature in a browser — type checks don't catch broken event wiring.

## Getting help

- Kukicha syntax / stdlib / gotchas — `.claude/skills/kukicha/SKILL.md`
- Codebase layout & data flow — `docs/ARCHITECTURE.md`
- Port history & build-pipeline rationale — `docs/plans/kukicha-port.md`
