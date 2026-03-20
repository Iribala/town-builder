# Technical Debt Report

**Date**: 2026-03-16
**Scope**: ~4,855 lines Python, ~7,546 lines JavaScript (excluding vendored libs)

---

## Critical — Fix Before Production

### ~~TD-001: Missing `zstandard` Dependency~~ ✅ RESOLVED

**Resolved**: 2026-03-16 — Added `"zstandard>=0.22.0"` to `dependencies` in `pyproject.toml`.

---

### ~~TD-002: Path Traversal in Static File Handlers~~ ✅ RESOLVED

**Resolved**: 2026-03-16 — Both `serve_js_files()` and `serve_wasm_files()` in
`app/utils/static_files.py` now resolve paths via `Path.resolve()` and validate them with
`.relative_to()` before serving, rejecting any `../` escape attempts with a 400 error.

---

### ~~TD-003: Global Mutable State Without Locks (Async Race Conditions)~~ ✅ RESOLVED

**Resolved**: 2026-03-16 — Added `asyncio.Lock` guards to all module-level mutable state:
- `app/services/events.py` — `_users_lock` protects `_connected_users`; `get_online_users()`
  is now async
- `app/services/storage.py` — `_storage_lock` protects `_town_data_storage` reads/writes
- `app/services/history.py` — `_history_lock` protects `_history_stack` and `_redo_stack`

---

### ~~TD-004: Batch Operations Lost-Update Problem~~ ✅ RESOLVED

**Resolved**: 2026-03-16 — Added `_batch_lock` (`asyncio.Lock`) in
`app/services/batch_operations.py` to serialize the entire read-modify-write cycle in
`execute_operations()`. A `_data_version` counter is incremented and stamped on each
successful save to support optimistic locking.

---

### ~~TD-005: Zero Test Coverage~~ ✅ RESOLVED

**Resolved**: 2026-03-18 — Added comprehensive pytest test suite with 120 tests across
10 test files in `external/tests/`. Coverage includes auth (JWT verification), security
(path traversal, SSRF validation), storage (Redis/in-memory fallback), normalization
(layout data round-trip), django_client (HTTP client mocking), town routes, proxy routes,
batch operations, and Pydantic schemas. Additionally, 26 Django integration tests in
kibigia validate the cross-repo contract (JWT interop, serializer shapes, layout round-trip).
See `docs/TEST-PLAN-TOWN-BUILDER.md` in kibigia for the full test plan.

---

## High — Significant Quality/Security Risks

### TD-006: No Rate Limiting or Request Size Limits

**Files**: `app/main.py:60-66`

Only CORS middleware is configured. No rate limiting, no request body size limits. Batch
endpoints and save endpoints accept unbounded payloads.

**Fix**: Add `slowapi` or `fastapi-limiter` for rate limiting. Configure request body size
limits in the ASGI server or via middleware.

> **Kibigia Interop — LOW RISK**: Kibigia's `django_client.py` makes service-to-service
> calls to town-builder. Ensure rate limits exempt internal traffic (e.g., via an
> allowlist or separate rate-limit tier for the Django backend's IP/token) so that
> legitimate sync and proxy requests are not throttled.

---

### ~~TD-007: SSRF in Proxy Request~~ ✅ RESOLVED

**Resolved**: 2026-03-19 (commit `524dbac`) — Added `validate_proxy_path()` in
`app/utils/security.py` that rejects schemes, authority components, parent traversal,
double slashes, encoded traversal sequences, backslashes, and null bytes. The final
constructed URL is also re-validated against the allowed domains list. Proxy route
handler returns 400 for invalid paths. 23 new tests cover SSRF vectors. All existing
kibigia proxy paths (numeric IDs, nested resources) verified working via integration tests.

---

### TD-008: Overly Permissive Schema Types

**Files**: `app/models/schemas.py`

Critical data fields use `Any` with no validation:
- Lines 46-49: `buildings`, `terrain`, `roads`, `props` are `list[dict[str, Any]]`
- Line 59: `SaveTownRequest.data: Any`
- Line 122: `BatchOperation.data: dict[str, Any]`
- Line 204: `FilterCondition.value: Any`, `operator: str` (should be `Literal`)

**Fix**: Create concrete Pydantic models for object structures (e.g., `PlacedObject`,
`BuildingData`). Use `Literal["eq", "ne", "gt", "lt", "gte", "lte", "contains", "in"]`
for filter operators.

> **Kibigia Interop — HIGH RISK**: `SaveTownRequest.data: Any` carries layout data
> that is stored in kibigia's `Town.layout_data` JSONField. Tightening this to a
> strict schema could reject existing data on round-trip (load from kibigia → save
> back). Before implementing, audit actual `layout_data` values stored in kibigia's
> database. During transition, use `model_config = ConfigDict(extra='allow')` to
> avoid rejecting unexpected keys. The same applies to `TownUpdateRequest` fields
> (`buildings`, `terrain`, `roads`, `props`) and `BatchOperation.data` — any
> concrete models must accept whatever kibigia has already persisted.

---

### TD-009: Duplicated Code Across Python Backend

**Pattern: broadcast + save** — `await set_town_data()` followed by
`await broadcast_sse()` appears 15+ times across `buildings.py` and `town.py`.

**Distance calculation** — Euclidean distance duplicated in:
- `app/routes/town.py:434-438`
- `app/services/batch_operations.py:258-260`
- `app/services/query.py:225-237`

**Category list** — `['buildings', 'vehicles', 'trees', ...]` hardcoded in
`buildings.py:101,142,180,252` and `scene_description.py:201`, while
`normalization.py:4` defines a `_CATEGORIES` constant that isn't reused.

**Magic number `2.0`** — Delete proximity threshold hardcoded in `town.py:445` and
`batch_operations.py:270`.

**Fix**: Extract shared helpers:
- `save_and_broadcast(town_data, event)` utility
- `calculate_distance(pos_a, pos_b)` in a shared math utility
- Single `CATEGORIES` constant imported everywhere
- `DELETE_PROXIMITY_THRESHOLD` constant

> **Kibigia Interop — LOW RISK**: The `save_town` refactor touches the code path
> that calls `django_client.create_town()` and `django_client.update_town()`.
> Extracted helpers must preserve the same call signatures and ensure
> `_prepare_django_payload()` receives identical arguments.

---

### ~~TD-010: Global `window.*` Pollution (JavaScript)~~ ✅ RESOLVED

**Resolved**: 2026-03-16 — Centralized all `window.*` state into `state/app-state.js` with proper getter/setter functions.

**Changes made**:
- Enhanced `app-state.js` with comprehensive state management for town info, WASM status, timing, auth tokens, base paths, and environment textures
- Updated `scene.js` to use centralized timing state instead of `window.deltaTime`/`window.elapsedTime`
- Updated `network.js` to use centralized auth and town state instead of `window.__TOKEN`, `window.__BASE_PATH`, and `window.currentTown*`
- Updated `main.js` to use centralized WASM state and town auto-loading logic
- Updated `ui.js` to use centralized town state for data payload construction and name changes
- Updated `models/loader.js` to use centralized base path state
- Updated `scene/scene.js` to use centralized environment map texture state
- Replaced all direct `window.*` property access with proper getter/setter function calls

**Benefits**: Eliminated global namespace pollution, improved maintainability, better testability, and consistent state access patterns.

---

### ~~TD-011: Collision Detection Duplicated 3 Ways (JavaScript)~~ ✅ RESOLVED

**Resolved**: 2026-03-16 — Consolidated collision detection into `models/collision.js`.

**Changes made**:
- Updated `controls.js` to import and use `checkCollision()` from `collision.js`
- Removed two duplicated O(n) collision detection loops in car physics code
- Eliminated ~40 lines of duplicated code

**Benefits**: Single source of truth for collision logic, improved maintainability.

---

### TD-012: God Objects / Overly Complex Functions

- `static/js/scene.js` (545 lines) — mixes scene init, animation loop, event handling,
  placement logic, frustum culling, and drive mode
- `app/routes/town.py:105-236` — `save_town` is 131 lines handling file validation, local
  saving, Redis storage, Django API integration, and complex branching
- `static/js/ui.js` (536 lines) — mixes mode management, notifications, context help, and
  event handlers
- `static/js/controls.js` (336 lines) — mixes keyboard input, camera controls, edit mode,
  and car physics

**Fix**:
- Split `scene.js` into `scene-lifecycle.js`, `animation-loop.js`, `frustum-culling.js`
- Extract `save_town` into smaller service functions (file save, redis save, django sync)
- Split `ui.js` into mode management, notifications, and event handlers
- Split `controls.js` into input handling and camera/physics modules

---

## Moderate — Maintainability & Reliability

### TD-013: Inconsistent API Error Response Formats

- `town.py:404` returns `{"error": "..."}`
- `town.py:235` returns `{"status": "error", "message": "..."}`
- `schemas.py:107` defines `ApiResponse` with `status`, `message`, `data`
- Some endpoints raise `HTTPException` with string detail, others with dict detail

**Fix**: Standardize all error responses on the `ApiResponse` schema. Add a custom
exception handler in `main.py` that wraps `HTTPException` detail into the standard format.

> **Kibigia Interop — MEDIUM RISK**: If kibigia's frontend JavaScript or any Django
> view parses error responses from town-builder (e.g., checking for `{"error": ...}`
> vs `{"status": "error", "message": ...}`), changing the format will break that
> parsing. Audit kibigia's proxy response handling and frontend error handlers before
> standardizing.

---

### ~~TD-014: Debug Logging Hardcoded for All Environments~~ ✅ RESOLVED

**Resolved**: 2026-03-16 — Updated `app/main.py` to set log level based on environment.

**Files**: `app/main.py:16-17`

**Changes made**:
- Imported `settings` from `app.config`
- Set `log_level = logging.DEBUG if settings.environment == "development" else logging.INFO`
- Updated `logging.basicConfig(level=log_level)` to use environment-aware level

**Benefits**: Prevents sensitive information exposure in production, improves performance by reducing debug log volume, and follows security best practices.

---

### TD-015: Snapshots Have No Redis Fallback

**Files**: `app/services/snapshots.py:58-61`

Raises an exception if Redis is unavailable, unlike `storage.py` which has an in-memory
fallback. Feature completely breaks without Redis.

**Fix**: Implement an in-memory fallback using a deque (matching the pattern in
`history.py`).

---

### ~~TD-016: JavaScript Memory Leaks~~ ✅ RESOLVED

**Resolved**: 2026-03-16 — Fixed three memory leak patterns.

**Changes made**:
- `controls.js`: Reuse `THREE.Box3` and `THREE.Vector3` instances instead of allocating new objects every frame in collision detection
- `collaborative-cursors.js`: Remove cursor from scene before disposing geometry/material to prevent orphaned references
- `scene/scene.js`: Add `disposeEnvironmentMap()` helper to properly clean up PMREM-generated environment textures on teardown

**Benefits**: Reduced garbage collection pressure, prevented texture memory leaks.

---

### ~~TD-017: WASM Initialization Race Conditions (JavaScript)~~ ✅ RESOLVED

**Resolved**: 2026-03-16 — Replaced polling-based WASM readiness checks with Promise-based signal.

**Changes made**:
- `utils/wasm.js`: Export `wasmReady` as a Promise that resolves when WASM loads
- `main.js`: Await `wasmReady` Promise instead of polling 50 times
- `scene.js`: Await `wasmReady` Promise for touch controls init instead of manual 10s timeout loop

**Benefits**: Eliminates race conditions, cleaner async/await pattern, proper error handling.

---

### ~~TD-018: SSE Reconnection Can Create Parallel Connections~~ ✅ RESOLVED

**Resolved**: 2026-03-16 — Added explicit connection state tracking to prevent parallel EventSource connections.

**Changes made**:
- Track `currentEvtSource` reference to properly close old connections
- Add `isConnecting` guard flag to prevent duplicate connection attempts
- Reset connection state on open/error events
- Close existing EventSource before creating new one on reconnect

**Benefits**: Eliminates parallel SSE connections during reconnection, proper cleanup.

---

### TD-019: Missing Schema Validation on Required Fields

**Files**: `app/models/schemas.py`

- `EditModelRequest` (lines 87-94) — No validation that at least one of
  position/rotation/scale is provided
- `DeleteModelRequest` (lines 79-84) — No mutual exclusivity between `id` and `position`
- `Position/Rotation/Scale` (lines 8-29) — No bounds; NaN, infinity, or extreme values
  accepted

**Fix**: Add `@model_validator` to enforce at least one field present. Add `Field(ge=, le=)`
constraints for coordinate bounds.

> **Kibigia Interop — MEDIUM RISK**: If kibigia's frontend sends edit requests with
> no position/rotation/scale fields (e.g., a metadata-only update), the new
> validator would reject them. Bounds constraints on `Position`/`Rotation`/`Scale`
> could also reject coordinates that kibigia currently allows. Check kibigia's
> frontend edit flows and any existing `layout_data` values for out-of-bounds
> coordinates before setting limits.

---

### TD-020: Unvalidated Sort/Filter Fields in Query Service

**Files**: `app/services/query.py:198-202`, `app/models/schemas.py:203`

`sort_by` accepts arbitrary field names with no whitelist. Filter operators accept
arbitrary strings.

**Fix**: Whitelist allowed sort fields. Use `Literal` type for operators.

> **Kibigia Interop — MEDIUM RISK**: If kibigia's frontend uses the query/filter API
> with field names or operators not on the new whitelist, those queries will fail.
> Audit kibigia's frontend query usage before finalizing the whitelist.

---

## Low — Code Quality & Best Practices

### ~~TD-021: Dead/Unused Code~~ ✅ RESOLVED

**Resolved**: 2026-03-16 — Removed four unused functions.

**Changes made**:
- `app/utils/normalization.py`: Removed `denormalize_to_layout_list()` (acknowledged unused in docstring) and `_array_from_vec()` helper
- `static/js/models/loader.js`: Removed `preloadModel()` function (exported but never imported)
- `static/js/collaborative-cursors.js`: Removed `getActiveCursorUsers()` (never called)
- `static/js/category_status.js`: Removed `removeStatusColor()` (never called)

**Total**: 121 lines removed.

---

### TD-022: Inconsistent JavaScript Module Patterns

- `app-state.js` exports getter/setter functions; `scene-state.js` exports bare variables
- Both `scene.js` (545 lines) and `scene/scene.js` (203 lines) exist with confusing naming
- Callback naming inconsistent: `onModelItemClick` vs `handleMouseWheel` vs
  `handleTouchStart`
- Mixed export patterns: some files export classes, some functions, some objects

**Fix**: Standardize on one pattern per concern. Rename `scene/scene.js` to
`scene/init.js` or similar to avoid confusion with the top-level `scene.js`.

---

### ~~TD-023: Hardcoded Magic Numbers~~ ✅ RESOLVED

**Resolved**: 2026-03-18 (commit `82f7af2`) — Moved magic numbers to config.

---

### ~~TD-024: Sensitive Data in Logs~~ ✅ RESOLVED

**Resolved**: 2026-03-18 (commit `82f7af2`) — Redacted sensitive log data.

---

### ~~TD-025: Accessibility Gaps (JavaScript)~~ ✅ RESOLVED

**Resolved**: 2026-03-18 (commit `82f7af2`) — Improved accessibility for toast notifications, joystick controls, collaborative cursors, and category status legend.

---

## Priority Matrix

| Priority | ID | Description | Effort | Kibigia Interop Risk | Status |
|----------|----|-------------|--------|----------------------|--------|
| ~~P0~~ | ~~TD-001~~ | ~~Add `zstandard` dependency~~ | ~~5 min~~ | None | ✅ Done |
| ~~P0~~ | ~~TD-002~~ | ~~Fix path traversal in static file handlers~~ | ~~30 min~~ | None | ✅ Done |
| ~~P0~~ | ~~TD-003~~ | ~~Add `asyncio.Lock` to global mutable state~~ | ~~1-2 hr~~ | None | ✅ Done |
| ~~P1~~ | ~~TD-004~~ | ~~Implement optimistic locking for batch ops~~ | ~~2-3 hr~~ | None | ✅ Done |
| P1 | TD-006 | Add rate limiting middleware | 1-2 hr | **Low** — exempt service traffic | |
| ~~P1~~ | ~~TD-007~~ | ~~Fix SSRF in proxy request~~ | ~~1 hr~~ | ~~**HIGH** — test all proxy paths~~ | ✅ Done |
| P1 | TD-008 | Replace `Any` types with concrete schemas | 2-3 hr | **HIGH** — audit layout_data first | |
| ~~P1~~ | ~~TD-010~~ | ~~Centralize JS state management~~ | ~~3-4 hr~~ | None | ✅ Done |
| ~~P2~~ | ~~TD-005~~ | ~~Add pytest test suite for critical paths~~ | ~~4-8 hr~~ | None | ✅ Done |
| P2 | TD-009 | Extract shared Python helpers | 2-3 hr | **Low** — preserve django_client calls | |
| ~~P2~~ | ~~TD-011~~ | ~~Consolidate collision detection~~ | ~~2-3 hr~~ | None | ✅ Done |
| P2 | TD-012 | Split god objects into focused modules | 4-6 hr | None | |
| P2 | TD-013 | Standardize API error responses | 1-2 hr | **Medium** — audit error parsing | |
| ~~P2~~ | ~~TD-014~~ | ~~Environment-based log levels~~ | ~~30 min~~ | None | ✅ Done |
| ~~P2~~ | ~~TD-016~~ | ~~Fix JS memory leaks~~ | ~~2-3 hr~~ | None | ✅ Done |
| ~~P2~~ | ~~TD-017~~ | ~~Promise-based WASM initialization~~ | ~~1-2 hr~~ | None | ✅ Done |
| ~~P2~~ | ~~TD-018~~ | ~~Fix SSE reconnection logic~~ | ~~1 hr~~ | None | ✅ Done |
| P3 | TD-015 | Add snapshot Redis fallback | 1-2 hr | None | |
| P3 | TD-019 | Add schema field validators | 1-2 hr | **Medium** — check frontend edit flows | |
| P3 | TD-020 | Whitelist sort/filter fields | 1 hr | **Medium** — audit query usage | |
| ~~P3~~ | ~~TD-021~~ | ~~Remove dead code~~ | ~~1 hr~~ | None | ✅ Done |
| P3 | TD-022 | Standardize JS module patterns | 2-3 hr | None | |
| ~~P3~~ | ~~TD-023~~ | ~~Move magic numbers to config~~ | ~~1-2 hr~~ | None | ✅ Done |
| ~~P3~~ | ~~TD-024~~ | ~~Redact sensitive log data~~ | ~~30 min~~ | None | ✅ Done |
| ~~P3~~ | ~~TD-025~~ | ~~Accessibility improvements~~ | ~~3-4 hr~~ | None | ✅ Done |
