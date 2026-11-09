# Town Builder — Security Review

**Date:** 2026-11-07 · **Scope:** full tree (`cmd/`, `internal/`, `static/`, `templates/`, `deploy/`: Dockerfile, k8s/, GitHub Actions, scripts/) · **Method:** manual source review (Kukicha + brewed Go semantics, Three.js frontend), plus `kukicha audit` for dependencies and a live `html/template` escaping check

---

## Executive summary

The codebase shows real security engineering effort: strict CORS allowlisting, a shared SSRF/path-traversal guard (`internal/utils/security`), request body limits, JWT algorithm pinning, contextual `html/template` escaping (verified safe against attribute/JS-string injection), and no committed secrets or private keys. The systemic weakness is **authorization**: the API authenticates users, but it never authorizes them against the resource they are mutating. In a shared multiplayer town, any authenticated user can overwrite *any* Django town, poison the client-broadcast state, and forge ownership records. There is also no HTTP timeout hardening, no security headers/CSP, and a production deploy following the shipped manifests would 400 every request (and fail kubelet probes) because `ALLOWED_HOSTS` is nowhere documented.

**Headline: 1 High, 8 Medium, 11 Low. None requires insider knowledge to exploit.**

> **Status 2026-11-08: the 1 High and 8 Medium findings have all been fixed and verified — see "Remediation status" below.**

---

## Findings

### HIGH

#### H1 — No object-level authorization on town state; ownership is client-supplied and never checked

The JWT proves *who* you are; nothing checks *what you may touch*. Concretely:

- **Overwrite any Django town.** `POST /api/town/save` with `{"town_id": <victim_id>, "data": …}` PATCHes `layout_data` to `TOWN_API_URL/{id}/` using the server's shared Django service token (`internal/routes/town/town.kuki:157-166`, `internal/services/django_client/django_client.kuki:204-221`). There is no check that the caller owns that town — Django sees one shared service account, so town-builder *is* the authorization layer, and it is absent. Same for `POST /api/town/save` without a `town_id` but with `townName` matching an existing town (`SearchTownByName` → `UpdateTown`).
- **GET with destructive side effects.** `GET /api/town/load-from-django/{id}` requires auth, but *mutates the global shared town* — it `storage.Set`s and broadcasts the loaded town to **all** connected clients (`town.kuki:253-290`). Visiting the URL replaces everyone's world with town #N. State change on a GET also defeats method-based protections and log/prefetch safety expectations. (Any authenticated user can also enumerate and pull private/other users' town layouts this way.)
- **Ownership index is forgeable and readable by anyone.** `storage.SetTownOwner(townIDStr, ownerDid)` takes `owner_did` from the **request body**, not the JWT (`town.kuki:203-207`). An attacker can attribute any town to any DID, and `GET /atproto/towns/{did}`, `/atproto/view/{did}`, and `/api/towns/by-owner/{did}` disclose the DID→town-ID mapping **with no authentication at all** (`internal/routes/atproto/atproto.kuki:21-35`, `internal/routes/towns/towns.kuki:19-30`).
- Snapshot restore, history undo/redo, `/api/town/load`, and all batch/building mutations act on the single global town with no per-user or per-town scoping. This may be a deliberate "one shared world" product decision — but then writes should be limited to *placement* actions, not arbitrary-state replacement, and Django sync of a specific `town_id` must still be owner-gated.

**Fix:** derive `did` from the verified JWT (`UserInfo.Did`) and use it for `SetTownOwner`/reads; gate `load-from-django`, `save` with `town_id`, snapshot `restore`, and history `undo/redo` behind ownership-or-collaborator checks; make `load-from-django` a POST; authenticate or delete the `by-owner`/`atproto/towns|view` endpoints.

---

### MEDIUM

#### M1 — Server has zero HTTP timeouts (Slowloris)
`cmd/server/main.kuki:37` uses `http.ListenAndServe(addr, handler)` — a zero-value `http.Server`: no `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, or `IdleTimeout`. A handful of slow connections can exhaust file descriptors. **Fix:** build an explicit `http.Server{…}` with timeouts; note `WriteTimeout` must tolerate SSE (or scope it per-route).

#### M2 — No security response headers; CDN scripts without SRI; unpinned CDN modules
No `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, or `Strict-Transport-Security` anywhere (grep confirms zero matches), and the landing page loads `bootstrap.bundle.min.js` and `@atcute/*` via `<script src>` / import map **without `integrity` and without version pinning** (`templates/index.html:8-10, 331, 386-391`). One compromised jsdelivr/esm.sh release = instant account/token theft in the highest-privilege page in the app (it holds the JWT and renders all shared state). **Fix:** set headers in middleware (at least `default-src 'self'` + tight `script-src`), self-host or pin-and-SRI all CDN assets, and consider dropping the esm.sh import-map dependency in favor of vendored files (three.js is already vendored).

#### M3 — Production deploy is broken by missing, undocumented `ALLOWED_HOSTS`; insecure default in `.env.example`
`config.kuki:122` defaults `AllowedHosts` to `localhost,127.0.0.1`; `TrustedHosts` returns **400 "host not allowed"** for anything else (`.kukicha/stdlib/http/http.go:398-420`). `ALLOWED_HOSTS` appears in **no** shipped artifact — not `.env.example`, not `k8s/`, not `Dockerfile`, not `README.md`/`docs/`. A deploy following the manifests 400s all external traffic, and kubelet HTTP probes (`/healthz`, `/readyz`, Host = pod IP) fail → liveness restart loop. Fix: set `ALLOWED_HOSTS` in the ConfigMap to `town.kibigia.org`, document it in `.env.example`, or fail closed with a clear startup error when `ENVIRONMENT=production` and it's unset.
In addition, `.env.example` ships `DISABLE_JWT_AUTH=true` as the default, and `prod.sh` only *warns* — a copy-paste deploy runs auth-free. Ship secure defaults (`DISABLE_JWT_AUTH=false`, empty secret → boot failure) and let dev opt in. Same file references `docs/SECURITY_FIXES.md`, which **does not exist** anywhere in the repo (also linked from `docs/ARCHITECTURE.md:518`).

#### M4 — JWT is mirrored into a JS-readable cookie and embedded in the page; ATProto session sits in localStorage
- `main.js` sets `auth_token=<jwt>; path=/; SameSite=Strict` (no `HttpOnly` possible — EventSource can't set headers), and `window.__TOKEN` holds it too. Any XSS anywhere in the app is full token theft (no HttpOnly boundary).
- `atproto.js` stores the ATProto OAuth session in `localStorage` (`atproto-session`) with `repo:… snapshot blob:*/*` scope.
These are inherent to the architecture, but with M2 they define the blast radius. **Fix:** prefer a dedicated, short-lived SSE cookie issued by the backend (HttpOnly) while keeping API auth on the `Authorization` header; at minimum ensure strict CSP so injected script cannot read them; consider `__Host-` prefix on the cookie.

#### M5 — Unauthenticated server-side fetch endpoints; unencoded query param; unbounded body reads
- `GET /api/terrain/{z}/{x}/{y}?src=<url>` — **no auth**; if `src` passes `security.ValidateApiURL` it is fetched server-side (`internal/routes/terrain/terrain.kuki:14-34`, `internal/services/terrain/terrain.kuki:38-58`). The allowlist limits targets, but an unauthenticated caller can make the server fetch allowlisted internal hosts on demand and can poison the shared tile cache with attacker-influenced JSON (`storage.CacheSet`) if an allowlisted host serves mutable content.
- `GET /atproto/identity/{handle}` — **no auth**; `handle` is spliced into the upstream URL **without URL-encoding** (`atproto.kuki:18` in services — `"…?handle=" + handle`) → query-parameter injection into the upstream request (parameter pollution / unexpected params). Also `did:web:` resolution replaces `%3A` with `:` so `did:web:localhost%3A6379` yields `https://localhost:6379/.well-known/did.json` whose *hostname* passes the allowlist — a narrow unauthenticated SSRF/port oracle against any HTTPS service on an allowlisted host returning a DID-doc-shaped JSON.
- Body reads are unbounded in `terrain.FetchTile`, `atproto` resolvers, and `django_client.decodeJSON` (`io.ReadAll` with no `LimitReader`) — unlike `kibigia_auth.ExchangeCode`, which correctly caps at 64 KiB. One rogue/compromised allowlisted upstream (or a big error page) can exhaust memory.
**Fix:** require auth (or at least per-IP rate limit + explicit public-by-design signage), `url.QueryEscape(handle)` / `url.Values`, strip/validate `%3A` in `did:web` hosts, and `io.LimitReader` everywhere with a consistent cap.

#### M6 — Write paths accept arbitrary top-level category keys; batch/buildings can corrupt shared state
`POST /api/batch/operations` `create`, and `POST /api/buildings` / `PUT /api/buildings/{id}` (new category) accept any `category` string with no validation against `normalization.Categories` (`services/batch/batch.kuki:52-72,168-180`, `routes/buildings/buildings.kuki:55-97,168-179`). `townData[category] = …` writes attacker-controlled top-level keys (e.g. `townName` becomes a *list of objects*), and `town_helpers.SaveAndBroadcast` persists **un-normalized** data and fans it out live to every client — a single request can poison the shared world for everyone until a manual reload fixes it. `Normalize` also isn't applied to batch write results. **Fix:** validate `category ∈ Categories` on every write path; normalize before `storage.Set`/broadcast.

#### M7 — No rate limiting anywhere
Every endpoint — including expensive ones: `POST /api/town/save` (one Django PATCH/CREATE + SSE broadcast per call), `POST /api/batch/operations` (up to 100 ops + full town rewrite + history entry per call), `POST /api/cursor/update` (one pub/sub publish fanned out to all SSE subscribers each call), `/events` connects — can be hammered by any authenticated user. **Fix:** per-user token bucket on mutating routes; per-IP limits on unauthenticated routes (M5); consider dropping cursor broadcast rate to ≤5 Hz per user.

#### M8 — `kukicha audit`: GO-2025-3540 in `github.com/redis/go-redis` v9.7.0
`internal/pubsub/pubsub.kuki:106` (Subscribe path). Fixed in **v9.7.3** — bump `go.mod`/`go.sum`. (Otherwise clean: 1 finding from 1 module.)

---

### LOW

- **L1 — SSE presence name is not tied to the JWT.** `/events?name=` uses a client-chosen cookie value and is neither verified nor length-capped (`events.kuki:62,70`, `main.js`/`network.js` set `userName` from a JS cookie). Any user can impersonate "Admin" in presence/cursor and smuggle oversized names into every client's DOM canvas. Use the JWT `username`.
- **L2 — Unauthenticated info disclosure.** `/healthz` reveals storage backend; `/readyz` returns raw Redis error strings (`health.kuki:11-41`). `/static/` serves a **directory listing** (`http.FileServer` without index). `/api/towns/mine` is fine (authed) but `by-owner`/`atproto/*` mirror it without auth (H1).
- **L3 — Reverse proxy leaks headers both ways.** `/api/proxy/*` forwards client request headers (incl. `Cookie`) to Django (`collectHeaders` skips only host/content-length), and copies upstream **response** headers verbatim except `content-length|transfer-encoding|connection|content-encoding` — so `Set-Cookie` from the upstream gets planted on the town-builder origin, and an explicit upstream `Accept-Encoding: gzip` request is never decompressed while its `Content-Encoding` is stripped (browser gets binary garbage). Skip `set-cookie`, `www-authenticate` request-side, and `accept-encoding` request-side too.
- **L4 — Global undo/redo; history entries carry full before+after town in Redis.** Any user can `POST /api/history/undo` to revert *anyone's* last op, with no actor attribution (`history.kuki`). Each entry stores two complete town snapshots; at the default `MAX_HISTORY_SIZE=100` that's ~200 town copies in Redis (a 1 MiB town → ~200 MiB) with no size ceiling — memory-exhaustion risk on the Valkey instance, and slow commits as towns grow.
- **L5 — Read-modify-write races.** `batch` holds `batchLock`, but `updateTown`, `saveTown`, `buildings` CRUD, `deleteModel`, `editModel`, snapshot restore — all do `Get → mutate → Set` with no shared lock. Concurrent editors silently lose each other's objects (last-writer-wins) in what is sold as a multiplayer editor. `storage.Set` has no compare-and-swap; consider Redis `WATCH`/Lua or an app-level mutex around all town mutations.
- **L6 — Valkey (Redis) is unauthenticated, unpinned, and ephemeral.** `k8s/07-valkey.yaml`: `valkey/valkey:latest`, no AUTH, no `NetworkPolicy`, no persistence config; town data/snapshots/history/owners ride it. Any pod in the namespace can read/forge the `town_events` pub/sub channel (forged `full`/`cursor` events to every browser) and dump all Redis keys. Also `data/` PVC commented out → emptyDir → data loss on pod restart.
- **L7 — Request ID honored from inbound header.** `RequestID` propagates a caller-supplied `X-Request-ID` into logs and responses (`requestid.kuki`) — log-correlation/spoofing and noise pollution. Keep it, but don't grant it trust semantics.
- **L8 — `town_id` type confusion.** In `saveTown`, a JSON *string* `town_id` is not `float64`, so `idInt` stays 0 → `PATCH {BASE}/0/` (`town.kuki:155-166`). Validate with a real type switch and reject wrong types with 400.
- **L9 — Token/code linger in the URL; Atproto `?code=` collides with kibigia `?code=`.** After the kibigia redirect the browser URL keeps `?code=…` (no server-side `302` to strip), leaking into history/proxy logs (single-use, 60 s TTL — mitigated). `atproto.js:handleAtprotoCallback` also interprets `?code=` and tries to finish an ATProto OAuth flow, then `replaceState`s the URL — a kibigia auth code is fed to the ATProto client (fails harmlessly, but sloppy and confusing).
- **L10 — In-memory fallback splits brain.** With Redis down, town/snapshot/history/owners live per-process in memory — and in the single-replica k8s deploy with `emptyDir`, a pod restart wipes the *shared* town with no warning (the app keeps serving from the default empty town). Fail loudly instead: if `ENVIRONMENT=production` and Redis is unavailable, refuse writes or refuse to boot.
- **L11 — Image/tag hygiene & toolchain drift.** `:latest` tags (`Iribala/town-builder`, valkey), `imagePullPolicy: Always`, no digest pinning, no CVE scan in CI; published Docker Hub image (`duber000/town-builder` in buildx.yml) doesn't match the k8s image (`Iribala/town-builder:latest`). `Dockerfile` pins `kukicha@v0.85.10` while the vendored stdlib is v0.86.7. `scripts/prod.sh`/`dev.sh` say 5000/127.0.0.1:5000 vs. the hardcoded `:5001` bind; `.env.example` says prod is port 5000 "matches Kubernetes" — it doesn't. `.github/workflows/buildx.yml` builds on release tags only; add `kukicha audit` + `go vet`/`staticcheck` + hadolint + gitleaks to CI.

### Design risks (note, not vulnerabilities)
- **Session fixation-ish flow:** `?token=<jwt>` is passed straight through and embedded in the page (`ui.kuki:62-65`). It is *not* verified or tied to the kibigia instance before rendering. An attacker who convinces a victim to open `…/?token=<attacker-jwt>` pins the victim to the attacker's account. Prefer the code flow exclusively, or mark the fallback clearly.
- **Shared Django service account:** all users act as one Django identity — no per-user audit, no per-town ACLs at the backend. Combined with H1, Django cannot tell user A from user B.
- **The common JWT verified locally** is good, but there is no revocation story (stateless HS256) — JWT `exp` is the only control; keep TTLs short.

---

## What's done well (keep it)
- SSRF/T traversal guards: `ValidateApiURL` (scheme-complete via `url.Parse` + host allowlist), `ValidateProxyPath`, `SafeFilepath`, `ValidateFilename`, `ValidateModelPath` — consistently applied.
- JWT: algorithm pinned via `WithValidMethods([JwtAlgorithm])`; "none" impossible; prod boot fails without `JWT_SECRET_KEY`; dev-token endpoint removed.
- CORS: exact-match allowlist, credentials echoed only for the match; no wildcard+credentials combo.
- `html/template` contextual escaping — **verified**: a token of `x';alert(document.domain);//` renders as `x\u0027;alert(document.domain);\/\/` and `javascript:` hrefs become `#ZgotmplZ`.
- Frontend DOM sinks are `textContent`/`createTextNode`/canvas, not `innerHTML`, for all server/user-controlled data (snapshot list has no innerHTML path).
- Body limit middleware (`MaxBytesReader`) wraps everything; `kibigia_auth` caps upstream body at 64 KiB; exchange secret compared constant-time on the Django side; single-use, 60 s auth codes — the right shape.
- `.dockerignore` excludes `.env`, `data/`, `.encryption-key`; Docker final stage is distroless + uid 65532; CLAUDE workflow `if:` restricts to repo owner; no `pull_request_target` misuse; no secrets in git history (checked).

---

## Remediation status (applied 2026-11-08)

All High and Medium findings have been addressed. Details per finding:

### H1 — FIXED
- Ownership now derives from the verified JWT `did` claim everywhere; the
  `owner_did`/`ownerDid` request-body fields are ignored (regression test:
  `ownership_test.kuki::TestClientOwnerDidIsIgnored`).
- `POST /api/town/load-from-django/{id}` replaces the old GET with side
  effects (GET now returns 405). Both it and `POST /api/town/save` with a
  `town_id` pass an ownership gate (`authorizeDjangoTown`): towns with a
  recorded owner are writable/readable only by that DID; unowned towns are
  claimable on a *successful* Django write (a failed sync never claims).
- `/api/towns/by-owner/{did}` requires auth and only returns the caller's own
  DID's towns. `/atproto/towns/{did}` and `/atproto/view/{did}` remain
  anonymous for the landing-page preview but disclose **count only**, never
  town IDs. Frontend call sites verified compatible.
- `/api/towns/mine` unchanged (caller's own DID). Global-town undo/redo and
  collaborative editing remain open to all authenticated users by design —
  the shared world has no per-user owner; per-town Django objects are what
  are now protected.
- Regression tests: `internal/routes/town/ownership_test.kuki` (claim on
  success, no claim on failed sync, non-owner 403, POST-only, body owner_did
  ignored). `town_test.kuki` updated to POST.

### M1 — FIXED
- Explicit `http.Server`: `ReadHeaderTimeout=10s`, `ReadTimeout=60s`,
  `IdleTimeout=120s`, `WriteTimeout=0` (documented: long-lived SSE streams
  must not carry a per-response write deadline). Slowloris now bounded by
  ReadHeaderTimeout.

### M2 — FIXED
- New `secheaders` middleware sets CSP, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, HSTS on every response.
  CSP: `default-src 'self'; script-src 'self' 'unsafe-inline'
  'wasm-unsafe-eval'; object-src 'none'; base-uri 'self';
  form-action 'self'; frame-ancestors …`. `frame-ancestors` is 'self' +
  origin of `KIBIGIA_EXCHANGE_URL`, overridable via `FRAME_ANCESTORS`
  (see .env.example/k8s ConfigMap) since the kibigia web origin can differ
  from the exchange API origin.
- The `https://esm.sh` exception in `script-src` was **removed**: the
  Bluesky sign-in modules are now self-hosted under `static/vendor/atcute/`
  (Phase 0 of the vanilla-JS evaluation, 2026-11-09). No third-party origin
  is needed in any directive.
- Bootstrap 5.3.0 / bootstrap-icons 1.10.0 are **self-hosted** under
  `static/vendor/` (no runtime jsdelivr dependency at all); icon fonts
  served as `font/woff2|woff`. Index responses carry `Cache-Control:
  no-store` (page embeds the JWT). Tests: `secheaders_test.kuki`.

### M3 — FIXED
- `ALLOWED_HOSTS` now documented in `.env.example` and set in
  `k8s/02-configmap.yaml` (`town.kibigia.org,localhost,127.0.0.1`).
  `config.Load()` **refuses to boot in production** when `ALLOWED_HOSTS` is
  unset (fail fast instead of 400-ing everything).
- Kubelet probes switched to **TCP-socket probes** (no Host header at all) —
  HTTP probes would have been rejected by the host allowlist and restart-looped.
- `.env.example` ships secure-by-default: `DISABLE_JWT_AUTH=false`,
  `JWT_SECRET_KEY` empty (server refuses to boot until set) instead of
  auth-disabled-by-default; prod.sh/check-health.sh/dev.sh/setup.sh updated
  accordingly (dev scripts generate a throwaway dev key). `docs/SECURITY_FIXES.md`
  references corrected to this document.

### M4 — FIXED (backend half; ATProto storage documented as residual)
- New `POST /api/auth/sse-cookie` sets the `auth_token` cookie as **HttpOnly**,
  `SameSite=Strict`, `Path=/`, `Secure` behind TLS/proxy. Frontend no longer
  mirrors the JWT into a JS-readable cookie (`document.cookie` removed from
  main.js and network.js); `network.js` establishes the cookie via the
  authenticated endpoint before opening the SSE stream.
- Index page carries `Cache-Control: no-store`; `frame-ancestors` +
  `X-Content-Type-Options`/CSP (see M2) bound the XSS blast radius.

### M5 — FIXED
- `/api/terrain/…` now requires authentication; z/x/y bounds checked; upstream
  read capped at 8 MiB; error responses no longer leak upstream detail.
- `/atproto/identity/{handle}` stays anonymous (landing-page preview) but:
  handle is passed via `url.Values` (no query injection), `did:web:` hosts
  must match a bare-host regex (no ports/paths/%3A oracle), upstream bodies
  capped at 1 MiB, and the failure response no longer echoes upstream errors.
- `django_client` reads (Town-by-ID, search, proxy passthrough) capped at
  32 MiB; oversized upstream → clean error.

### M6 — FIXED
- Batch `create` and buildings `create`/`update` validate `category ∈
  normalization.Categories` (400 on violation; arbitrary top-level keys like
  `townName` can no longer be created or broadcast).
- Town data is normalized before `storage.Set` **and** before SSE broadcast
  in batch, buildings (create/update/remove) and snapshot restore, so shared
  state is always canonical and clients no longer need to tolerate poisoned
  payloads.
- Regression tests: `batch_test.kuki` (arbitrary/`__proto__` category keys
  rejected).

### M7 — FIXED
- New `ratelimit` middleware: per-identity fixed-window limiter keyed on the
  bearer token (hashed; never stored raw) with remote-address fallback (not
  X-Forwarded-For). Tiers: 600 req/min default (covers 10 Hz cursor
  broadcasts), 60 req/min for Django-write/state-restore endpoints
  (`/api/town/save`, `/api/town/load`, `/api/batch/*`, `/api/snapshots*`,
  `/api/history*`, `/api/town/load-from-django/*`); `/events` exempt;
  429 + `Retry-After: 60` on overflow. Tests: `ratelimit_test.kuki`.

### M8 — FIXED
- `github.com/redis/go-redis/v9` bumped 9.7.0 → 9.7.3. `kukicha audit`
  reports **no vulnerabilities found**.

### Verified
- `kukicha check ./...` ✓ · `kukicha fmt --check` ✓ · `go build ./...` ✓
- `go test ./...` ✓ (all packages, incl. new ownership/ratelimit/secheaders/
  batch regression tests) · `go vet` ✓ · JS tests 19/19 ✓
- Smoke tests: production boot fails closed without ALLOWED_HOSTS; 401 on
  unauthenticated /api/town, /api/terrain, /api/towns/by-owner; GET→405 on
  load-from-django; dev login flow works; vendored assets serve 200 with
  correct MIME (font/woff2); page 200 with `Cache-Control: no-store`.

### Residual / explicitly out of scope
- **ATProto OAuth session in localStorage** — inherent to the atcute browser
  client (must survive reloads); mitigated by the CSP now in place and by
  vendoring the @atcute modules under `static/vendor/atcute/`. Moving to a
  backend-mediated OAuth flow is a larger change.
- **Global undo/redo and collaborative global town** remain open to all
  authenticated users by design; per-account attribution and op-level
  authorization for the shared world was not added.
- **Ownership model for pre-existing shared towns**: `/api/town/save` without
  town_id (global town) and batch/buildings edits are still world-writable;
  ownership enforcement applies only to Django-scoped towns with recorded
  owners (first-write-claims). A stricter policy (e.g., kibigia-sourced ACL)
  belongs in the kibigia service.
- **L-series findings remain open** (Low severity): presence-name spoofing
  (L1), /readyz detail, static dir listing (L2), proxy header leakage both
  ways (L3), hosted full-town history entries (L4), read-modify-write races
  (L5), Valkey hardening (L6), inbound X-Request-ID (L7), town_id type
  coercion (L8), URL token lingering (L9), in-memory fallback divergence
  (L10), image tag/provenance hygiene (L11).
- **TCP socket probes** trade the Redis readiness check for deterministic
  probes under the host allowlist; `/readyz` remains available on the public
  hostname for external monitoring.

---

## Suggested remediation order
1. **H1** — JWT-derived DID for ownership; owner gate on `save`/`load-from-django`/`restore`; POST-only `load-from-django`; auth or remove `by-owner`/`atproto` read endpoints; stop accepting `owner_did` from bodies.
2. **M3, M1, M2** — fix the 400-everything deploy, add server timeouts, headers + CSP + SRI/pinned CDN. These are hours of work, not weeks.
3. **M5, M6, M7** — auth+limits on terrain/atproto, category validation on writes, normalize-then-broadcast, basic rate limiting.
4. **M8, M4, L-series** — bump go-redis, cookie/token hardening, k8s auth/pinning/NetworkPolicy, CI security jobs.

## Verification notes / assumptions
- Django's own authorization was **not** reviewed (not in this repo). H1's exploitability at the Django layer assumes the shared service token grants broad PATCH/CREATE on `layout_data` — consistent with the client code paths; if Django independently enforces per-town ACLs, impact shifts to "any user edits the shared global town" (still High in a multi-tenant deploy).
- k8s file `infrastructure/06-job-generate-shapes.yaml` references `uv run flask generate-shapes` — stale from the pre-Kukicha era; harmless but confusing; recommend deleting.
- Local working tree `.env` is properly gitignored and contains development settings (`DISABLE_JWT_AUTH=true`); it is not committed.
- The frontend was reviewed statically; runtime testing in a browser was not performed. Claims about three.js rendering are out of scope.
