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
- **Frontend** – Vanilla JavaScript + Three.js (no framework). `static/js/scene.js` is the central orchestrator; `static/js/ui.js` handles DOM events; `static/js/network.js` manages SSE reconnection. Overlay UI styling lives in `static/css/app.css` (design system, loaded after Bootstrap and before `static/css/mobile.css`).
- **Physics WASM** – `physics_wasm.kuki` brews to `physics_wasm.go` and compiles to `static/wasm/physics_greentea.wasm`. Exposes a spatial-grid collision system and car physics as global JS functions (`wasmUpdateSpatialGrid`, `wasmCheckCollision`, `wasmBatchCheckCollisions`, `wasmUpdateCarPhysics`, etc.). WASM loading is non-critical; the app degrades gracefully if it fails.

**Multiplayer flow:** client POST → backend saves to Redis → publishes to Redis Pub/Sub channel `town_events` → SSE endpoint (`GET /events`) fans out to connected clients.

## Web UI (frontend) conventions

Pointers from the overlay-UI "glass" redesign (November 2026) and the Oat UI migration that replaced Bootstrap the same month. These are check-it-yourself rules for agents editing the web UI; no external skill or tooling is required.

- **CSS load order** (`templates/index.html`): Oat → bootstrap-icons → `static/css/app.css` → `static/css/mobile.css`. New overlay-UI styles go in `app.css`; mobile-specific overrides go in `mobile.css`, which is intentionally **unlayered and `!important`-free** — unlayered rules beat every cascade layer, so mobile overrides win over `app.css`'s `@layer components` without `!important`.
- **`app.css` styles live in `@layer components`** (reusing Oat's layer position, loaded after Oat so we win ties; Oat's utilities layer still beats us, which is fine — matching helpers have matching values). **The `.hidden` utility is unlayered at the very end of `mobile.css`** so it beats everything in both files regardless of specificity — JS toggles visibility exclusively with `classList.toggle('hidden', …)` / `add` / `remove`, never `el.style.display`. Unlayered `.tutorial-overlay`-style `display:flex` would beat a *layered* `.hidden`, which is why `.hidden` cannot live in `app.css`. No `!important` anywhere in `app.css`/`mobile.css` except `.visually-hidden` and the `forced-colors` block.
- **Oat (Oat UI, `@knadh/oat` 1.1.0) styles semantic elements out of the box** — no utility-class soup. It uses `@layer theme, base, components, animations, utilities`; do not add `!important` to beat Oat — `app.css`'s `@layer components` loads after Oat's and mobile.css is unlayered, so both win naturally. Oat requires `light-dark()` and `color-scheme: light dark`; keep both (see the next two bullets). The npm tarball is verified against the registry integrity hash when installing — keep that practice for any vendored asset. Oat is ~11KB gz and zero-dependency; don't put a framework on top of it.
- **Oat theme variables, not element styles, are the theming hook.** `app.css` maps Oat's `--primary`/`--primary-foreground`/`--ring`/`--danger` to the app's emerald accent in `light-dark()` pairs, and `--background`/`--foreground`/`--card`/`--card-foreground` to the app surface tokens (so `<body>` and Oat's toast/dialog chrome match the app, not Oat's neutrals). Buttons: native `<button>` (primary styling), `data-variant="danger"|"secondary"`, `.outline` modifier, `.small` size; connected groups are `<menu class="buttons"><li><button>`; switches are `input[type="checkbox"][role="switch"]`; selects/ranges/inputs styled natively; `fieldset.group` joins an input and a button into one control; `.hstack`/`.vstack`/`.justify-between`/`.w-100`/`.mb-*`/`.mt-*` helpers ship in Oat's utilities layer.
- **A small transitional shim block in `app.css` duplicates a handful of utility classes** (`.mb-*`, `.mt-*`, `.pt-3`, `.me-*`, `.d-block`, `.text-muted`, `.user-item`) only because the markup/JS still references them. Don't add new shims — write a real class or use Oat's native helpers.
- **JS-created chrome must carry the design system with it.** Create elements with classes styled in `app.css`/`mobile.css` — never `element.style.cssText` walls or hardcoded hex (the old `#666` legend text failed 2.8:1 in dark mode). Dynamic inline styles for *data* (e.g. a status-swatch background) are fine. **Markup and CSS must use the same names**: a class or id that no stylesheet rule knows fails silently — this is how `fixed-top` (dead since Bootstrap left) quietly left the navbar static and `bg-info` left the mobile camera-mode hint invisible. Icon-only JS-created controls need accessible names; text-bearing transient chrome gets `role="status"` (polite) or `role="alert"` (assertive).
- **Toasts come from Oat's `ot.toast()`** (e.g. `window.ot.toast(message, '', { variant, placement: 'bottom-center', duration })`), called from `ui.js`. `ot` is a global from the deferred `oat.min.js`. Never hand-build toast DOM or reintroduce `bootstrap.Toast`; for severity, `success`/`danger`/`warning`/default `info` map 1:1 from `showNotification`'s types.
- **App tokens are single `light-dark()` definitions** on `:root`, keyed off `color-scheme` — the same mechanism Oat's theme vars use, pinned to the toggle by the `:has()` mappings. Adding/changing a token means editing one definition. `data-theme` remains as the JS/FOUC hook (theme icon swaps, mobile backdrop) — don't re-declare tokens in media queries or `[data-theme]` component rules. The `@supports (backdrop-filter)` glass downshift and the `@media (prefers-contrast: more)` strengthening also collapse to single `light-dark()` definitions; `forced-colors` stays explicit (Canvas/CanvasText are scheme-independent).
- **CSP is deliberately permissive on inline code** (`internal/middleware/secheaders/secheaders.kuki`): `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'` — `'unsafe-inline'` covers the inline FOUC script, inline theme-toggle, inline server-embed (`window.__TOKEN` / `__STATIC_VERSION__` / TownID), the inline importmap and the inline WASM loader in `templates/index.html`; `'wasm-unsafe-eval'` is required by the Go WASM physics module and stays while it exists. `style-src 'unsafe-inline'` is likewise load-bearing — the webgl2 shim and tutorial set `el.style.*`, which counts as the style attribute. `object-src 'none'`, `base-uri`, `form-action` and `frame-ancestors` are locked down. Rules: **no new inline `<script>`/`<style>` blocks or `style=` attributes in `templates/index.html`** — new code goes in static files. Direction of travel is race-to-the-crystal's posture (`default-src 'self'`, zero inline): once the FOUC/toggle/importmap/WASM-loader and the server-embed globals are externalized, `script-src` can drop `'unsafe-inline'`. If you change the CSP, update `secheaders_test.kuki` to match.
- **Theming is `data-theme` + `<meta name="color-scheme">` + `localStorage["color-scheme"]`.** The inline FOUC-prevention script in `<head>` must stay before the stylesheets and run unconditionally; `:root`'s `color-scheme` must stay `light dark` (the `:has()` mappings pin it to the meta). Never hardcode `color-scheme` to a single scheme. Oat and UA chrome (scrollbars, color wells) key off `color-scheme`; our `app.css`, `mobile.css` and Oat's `light-dark()` all follow the same pinned value — both are set together in the FOUC script and in the toggle handler. `theme-color` is a single meta **without media attributes**, kept in sync with the mapped `--background` (`#ffffff` light / `#141821` dark) by the same FOUC + toggle code — if you change `--background`, change both (and the `app.css` token comment).
- **The landing dialog is a native `<dialog>`** (`showModal()`, `closedby="any"`, `form method="dialog"` close button). Keep it native — do not reintroduce a UI-framework modal for it. `closedby` is ignored by Safari by design; Esc still works, so light-dismiss is progressive enhancement, not a requirement.
- **Scrollbars:** use `scrollbar-color`/`scrollbar-width` on the scroll container; any `::-webkit-scrollbar` fallback must live inside `@supports not (scrollbar-color: auto)` — sharing selectors across both flickers in WebKit.
- **Reduced motion:** dampen spatial movement only (opacity/color transitions may stay). Never add `* { animation-duration: 0.01ms !important }` or similar global kills.
- **Contrast budget:** overlay chrome floats over arbitrary 3D-scene backdrops (sky can be near-white). Keep text ≥4.5:1 and borders/non-text ≥3:1 against the *worst-case* backdrop, not against the screenshot backdrop. If you use `backdrop-filter` glass, keep the `@supports not (backdrop-filter: …)` opaque-surface fallback, and keep dark glass at ≥ ~0.78 alpha.
- **No color-only state.** Toggled/pressed state keys off `aria-pressed` (see `.mode-button[aria-pressed="true"]`), which needs an inset contrast cue (inset ring) on translucent surfaces. Toasts carry `role="status"` (polite) or `role="alert"` (assertive) by severity, and icon-only controls need accessible names.
- **The vendored bootstrap-icons is 1.13.2** (verified against the registry tarball). It's kept in sync with Bootstrap releases — check the name exists before using it (`bi-folder-open` doesn't exist; `bi-folder` and `bi-bluesky` do).
- **Static assets are content-hashed at server startup.** After editing `static/` or `templates/`, restart the dev server — the old hash keeps serving stale/404s otherwise.
- **Headless check loop:** chrome-devtools MCP — `new_page`/`navigate_page` → `take_screenshot` (save to `/tmp/opencode/` and Read it) → `take_snapshot` to inspect the a11y tree (landmarks, `aria-pressed`, live regions, focus). Note: the headless window reports `innerWidth` ≥ ~728px even for small resize requests, so ≤576px phone-only rules can't be verified this way; spot-check on a real device/UA emulation.
- **`mobile.css` positioning depends on `--bottom-sheet-peek`** (50–60px); the attribution pill anchors above it. The `<meta viewport>` must keep `viewport-fit=cover` or `env(safe-area-inset-*)` resolves to 0.

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
