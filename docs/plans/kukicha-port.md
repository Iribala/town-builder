# Kukicha port plan

Port the non-JS parts of Town Builder (Python/FastAPI backend, Go WASM) to Kukicha. Frontend (`static/js/`) stays untouched.

## Decisions (user-confirmed)

- Web framework: **`net/http.ServeMux`** (Go 1.22+ method patterns) + `stdlib/http` helpers. **No chi.**
- External Go deps: `github.com/redis/go-redis/v9`, `github.com/golang-jwt/jwt/v5`, `github.com/klauspost/compress/zstd`.
- Middleware: CORS + body-limit written ourselves; `stdlib/http.SecureHeaders` / `WithCSRF` for the rest.
- Templates: Jinja2 → `stdlib/template` (or `stdlib/html` Fragment components).
- Keep `tests/` (Python) and `pyproject.toml` during transition — hard-cutover later.
- Brewed `.go` files **are committed** alongside `.kuki` sources so `go test` works without a build step.
- `.kukicha/` (extracted stdlib) is **gitignored** — re-runnable via `kukicha init`.

## Target layout

```
town-builder/
├── go.mod
├── cmd/server/main.kuki                # HTTP server + Redis pubsub bootstrap
├── internal/
│   ├── config/         ✅ stage 1
│   ├── models/         ✅ stage 1 (value types only; request unions deferred)
│   ├── normalization/  ✅ stage 1
│   ├── storage/        ✅ stage 1  (5/5 tests pass)
│   ├── pubsub/         ◻ stage 4
│   ├── services/
│   │   ├── django_client.kuki
│   │   ├── auth.kuki
│   │   ├── history.kuki
│   │   ├── query.kuki
│   │   ├── snapshots.kuki
│   │   ├── batch.kuki
│   │   ├── scene_description.kuki
│   │   ├── town_helpers.kuki
│   │   └── model_loader.kuki
│   ├── routes/         ◻ stage 3 (13 modules)
│   ├── middleware/     ◻ stage 3 (cors, bodylimit)
│   └── utils/
│       ├── security.kuki   (JWT + SSRF)
│       ├── geometry.kuki
│       └── static_files.kuki
├── physics_wasm.kuki   ◻ stage 7 (optional)
└── .claude/skills/kukicha/SKILL.md    # canonical reference
```

## Stages

### Stage 1 — Foundation ✅ (commit `3c6838f`)

Config, models (value types), normalization, storage with Redis fallback + zstd. Storage tests pass.

### Stage 2 — Services + utils

Pure-logic packages, no HTTP yet.

Files to port:
- `app/utils/security.py` → `internal/utils/security.kuki` (JWT validate via `golang-jwt/v5`, SSRF via `stdlib/netguard`)
- `app/utils/geometry.py` → `internal/utils/geometry.kuki`
- `app/services/django_client.py` → `internal/services/django_client.kuki` (`stdlib/fetch.NewExternal` builder)
- `app/services/auth.py` → `internal/services/auth.kuki`
- `app/services/history.py` → `internal/services/history.kuki`
- `app/services/query.py` → `internal/services/query.kuki` (spatial filters, no WASM bridge — server-side only)
- `app/services/snapshots.py` → `internal/services/snapshots.kuki`
- `app/services/batch_operations.py` → `internal/services/batch.kuki`
- `app/services/scene_description.py` → `internal/services/scene_description.kuki`
- `app/services/town_helpers.py` → `internal/services/town_helpers.kuki` (Redis pubsub publish)
- `app/services/model_loader.py` → `internal/services/model_loader.kuki`

Add back `golang-jwt/v5` to `go.mod` once `auth.kuki` imports it.

### Stage 2 notes (lessons learned)

Posted as a followup on https://github.com/kukichalang/kukicha/issues/115#issuecomment-4492086318. The skill at `.claude/skills/kukicha/SKILL.md` carries the up-to-date list — points below are summary only.

- **Type conversions:** Always `x as T`, never `T(x)`. `T(x)` brews to `T{}(x)` (broken) for `[]byte`, `int64`, `float64`, named types, etc.
- **Reserved identifiers:** `list`, `as`, `default`, `fallback`, `in`, `error`, `empty` cannot be local var or param names. Use `items`, `astr`, `def`, `arr`, etc.
- **Map iteration:** `for k in m` iterates values (and the IDE warns); use `for k, _ in m` for keys, or the `maps.Keys()` workaround when both vars are needed across packages.
- **Lambdas need single-expression bodies for inference:** multi-statement lambdas inside `sort.Slice` failed return-type inference. Hoist the body into a named func and pass `(i, j) => helper(items, i, j)`.
- **ctxpkg.WithTimeout returns `Handle` (value), not `*Handle`.** Don't wrap in `reference`.
- **Type switch syntax** is `switch x as v ... when T`, not `switch v in x`.
- **No struct-pointer method receivers via `on`:** `func M on s: *T` doesn't work; use `func M on s: reference T` (with `dereference s` inside if needed) or stick to ordinary funcs for stateful ops.

### Stage 3 — Routes + middleware + main

Wire up the HTTP server end-to-end.

- `internal/middleware/cors.kuki` (handler wrapping with Access-Control-* headers)
- `internal/middleware/bodylimit.kuki` (wrap with `http.MaxBytesReader`)
- `internal/routes/router.kuki` (registers all sub-routers on `*http.ServeMux`)
- 13 route files matching the Python `app/routes/` layout
- `cmd/server/main.kuki` — `config.Load()`, `storage.Initialize(redisURL)`, mux setup, `http.Serve(addr, h)`

Acceptance: `/healthz`, `/readyz`, `/api/town` GET/POST, `/api/config` all respond correctly against `localhost:5001`.

### Stage 4 — SSE + Pub/Sub

- `internal/pubsub/pubsub.kuki` — single goroutine subscribed to Redis `town_events`, fans out to N SSE channels via `chan []byte`. Tracks per-user connection count; enforce `MaxSseConnectionsPerUser`.
- `internal/routes/events.kuki` — SSE handler: `w.(http.Flusher)`, write `data: ...\n\n` per event, respect `r.Context().Done()`.
- `internal/routes/cursor.kuki` — POST cursor update → publish on pubsub channel.

### Stage 5 — Proxy + UI + static

- `internal/routes/proxy.kuki` — pass-through to Django API with SSRF check via `stdlib/netguard`.
- `internal/routes/ui.kuki` — `stdlib/template.CompileHTML` at startup, render `index.html` with `settings.root_path`.
- Static serving via `http.FileServer(http.Dir("./static"))` + custom MIME for `.wasm`.

### Stage 6 — Tests port

Port `tests/test_*.py` (11 files, ~1800 lines) to `*_test.kuki`. Strategy per file:

| Python file | Notes |
|-------------|-------|
| `test_storage.py` | ✅ already ported |
| `test_normalization.py` | Pure-logic; direct port |
| `test_schemas.py` | Defer until request-union schemas exist |
| `test_security.py` | SSRF + JWT — depends on stage 2 |
| `test_auth.py` | Depends on stage 2 |
| `test_django_client.py` | `httptest.NewServer` for the mock; inject base URL via settings |
| `test_town_routes.py` | Hits the real mux; use `httptest.NewServer` against `routes.NewMux()` |
| `test_buildings.py`, `test_batch_operations.py`, `test_proxy_routes.py`, `test_request_limits.py` | Same pattern as above |

Keep Python tests passing in parallel until parity is verified.

### Stage 7 — WASM (optional)

Translate `physics_wasm.go` → `physics_wasm.kuki`. Mostly mechanical (`&&` → `and`, `||` → `or`, `for ... range` → `for x in xs`, etc.). Build with `kukicha build --wasm`. Output to `static/wasm/physics_greentea.wasm` (path matches existing JS loader).

### Cutover

Once stages 2–6 land and tests pass:
- Delete `app/`, `tests/`, `pyproject.toml`, `uv.lock`, `conftest.py`, `requirements.txt`.
- Retire `scripts/dev.sh`/`prod.sh` Python invocations; replace with `kukicha run cmd/server/` / `kukicha build cmd/server/`.

User said: keep Python tests + `pyproject.toml` for now.

## Build pipeline

Until we automate, manual flow per package:

```bash
# Production code (one main.go per package)
kukicha brew internal/<pkg>/

# Tests — directory brew skips _test.kuki, do per-file
kukicha brew --stdout internal/<pkg>/<name>_test.kuki > internal/<pkg>/<name>_test.go

# Run
go test ./internal/...
go build ./...
```

Plan to add `scripts/build.sh` later that walks `internal/`, brews each dir, and brews each `_test.kuki` to `_test.go`. Not blocking.

## Kukicha tips learned (filed upstream as kukichalang/kukicha#115)

The full reference is in `.claude/skills/kukicha/SKILL.md`. Highlights worth keeping front-of-mind:

### Reserved keywords can't be identifiers

`default`, `fallback`, `in`, `error`, `empty` cannot be used as parameter or local variable names. Parser errors are opaque (`expected identifier` / `unexpected token in expression: IN`). Pick `def`, `src`, `name`, etc.

### Multi-return signatures need parens

```kukicha
# WRONG (doc shows this; parser rejects)
func F() T, error
# CORRECT
func F() (T, error)
```

### Map iteration brews wrong

```kukicha
for k, v in someMap      # brews to `for k := range`, k = int — bug
```

Workaround:

```kukicha
keys := maps.Keys(someMap)
for i from 0 to len(keys)
    k := keys[i]
    v := someMap[k]
```

### External package onerr

```
cannot use onerr on call to pkg.X: return signature is unknown.
```

Either annotate with `# kuki:returns N` above the call, or capture and check:

```kukicha
err := pkg.X(args)
if err isnt empty
    return err
```

### External packages need explicit alias

```kukicha
import "github.com/redis/go-redis/v9" as redis
```

Without `as redis`, `redis.X` is undefined.

### Tests live in `<name>_test` petiole

Test files must use `petiole <pkg>_test` and access the package via its **public** API only. Brewing has issues with `_test.kuki`:

- `kukicha brew dir/` **silently skips** `_test.kuki`. Workaround: `kukicha brew --stdout foo_test.kuki > foo_test.go` per file.
- For storage-style tests that need to poke private state, add `ResetForTest` / `SetClient` exported helpers to the production package.

### `json.Parse` is generic; use `ParseInto` to decode into existing var

```kukicha
out := make(map of string to any)
json.ParseInto(data, reference of out)
# vs
val := json.Parse of MyStruct from data
```

### Typed-nil interface gotcha in tests

`test.AssertNil(t, someFunc())` fails when the function returns a typed nil pointer (`*redis.Client(nil)`) — wrapping it in `any` creates a non-nil interface. Use `test.AssertTrue(t, x equals empty)` instead.

### `reference of T{...}` for struct-literal pointers

```kukicha
s := reference of Settings{Field: "x"}       # equivalent to Go's &Settings{...}
```

### onerr with default values

```kukicha
v := env.GetFloatOr(key, def) onerr def      # default-on-error pattern
```

Note: onerr inside struct field initializers is *not* supported — factor to a helper func returning a single value.

## Open questions to revisit

- WASM port: do we actually want it in Kukicha, or leave the existing Go file? It already builds.
- `physics_wasm.go` is invoked from JS as global functions. The current Go file uses `syscall/js`. Kukicha would still need that — verify before stage 7.
- Pydantic `extra="allow"` semantics for `PlacedObject` request bodies: tests rely on extra fields surviving the round-trip. Approach: keep request payloads as `map of string to any` at the route boundary, only validate known fields.

## Status

| Stage | Status | Commit |
|-------|--------|--------|
| 1 — Foundation | ✅ done | `3c6838f` |
| 2 — Services + utils | ✅ done | — |
| 3 — Routes + middleware + main | ✅ done | — |
| 4 — SSE + Pub/Sub | ✅ done | — |
| 5 — Proxy + UI + static | ✅ done | — |
| 6 — Tests port | ✅ done | — |
| 7 — WASM (optional) | ✅ done | — |

### Stage 6 notes

Ported 9/10 test files; `test_schemas.py` remains deferred (per the schemas plan). 67 test cases across:

- `internal/normalization/normalization_test.kuki` — 16 cases
- `internal/utils/security/security_test.kuki` — 30 cases
- `internal/services/auth/auth_test.kuki` — 11 cases
- `internal/services/django_client/django_client_test.kuki` — 22 cases
- `internal/services/batch/batch_test.kuki` — 6 cases
- `internal/routes/town/town_test.kuki` — 13 cases
- `internal/routes/proxy/proxy_test.kuki` — 7 cases
- `internal/routes/batch/batch_test.kuki` — 5 cases

Tests use `httptest.NewServer` against `router.NewMux()` with `config.SetForTest()` for settings injection (added `SetForTest` to `internal/config`). Real bug fixed during port: `django_client.SearchTownByName` only handled paginated map responses; now handles both plain list and `{"results": [...]}` shapes (Python parity).

### Stage 7 notes

`syscall/js` type-checks and brews cleanly in Kukicha. `physics_wasm.go` (626 lines) ported to `physics_wasm.kuki` (493 lines). Ported using:
- Explicit consts instead of `1 << iota` bit flags (Kukicha enums are sequential only).
- Module-level funcs taking `reference SpatialGrid` instead of `*T` method receivers.
- `for k, _ in map` for map iteration; `for i := range length` → `for i from 0 to length`.
- Local function-scope `const` not supported — use `:=` assignment.
- No `println` builtin — use `fmt.Println`.

Build flow: `kukicha brew --stdout physics_wasm.kuki > physics_wasm.go`, then sed-replace `//go:build ignore` → `//go:build js && wasm` (kukicha emits `ignore` constraint; WASM build needs the real one), then `./build_wasm.sh`. Output: `static/wasm/physics_greentea.wasm` (2.6 MB).
