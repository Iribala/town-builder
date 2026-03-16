# Technical Debt Report

**Date**: 2026-03-16
**Scope**: ~4,855 lines Python, ~7,546 lines JavaScript (excluding vendored libs)

---

## Critical — Fix Before Production

### TD-001: Missing `zstandard` Dependency

**Files**: `pyproject.toml`, `app/services/storage.py:8`, `app/services/snapshots.py:6`

The `compression` (zstandard) library is imported in storage and snapshots but not declared
as a dependency in `pyproject.toml`. The app will crash at runtime when Redis storage or
snapshots are accessed.

**Fix**: Add `"zstandard>=0.22.0"` to `dependencies` in `pyproject.toml`.

---

### TD-002: Path Traversal in Static File Handlers

**Files**: `app/utils/static_files.py:20,35`

`serve_js_files()` and `serve_wasm_files()` pass user-controlled `file_path` directly to
the filesystem without boundary validation. An attacker could use `../` sequences to escape
the intended directory. The `security.py:get_safe_filepath()` pattern already exists but
isn't used here.

**Fix**: Resolve paths and verify they remain within the base directory using
`Path.resolve()` and `.relative_to()`, matching the pattern in `security.py`.

---

### TD-003: Global Mutable State Without Locks (Async Race Conditions)

**Files**:
- `app/services/events.py:13` — `_connected_users: dict`
- `app/services/storage.py:53` — `_town_data_storage` dict
- `app/services/history.py:18-19` — `_history_stack` and `_redo_stack` deques
- `app/services/batch_operations.py:362` — singleton manager

Multiple module-level mutable structures are modified from async handlers with no
synchronization. Concurrent requests can corrupt shared state.

**Fix**: Add `asyncio.Lock` guards around all read-modify-write operations on shared state.

---

### TD-004: Batch Operations Lost-Update Problem

**Files**: `app/services/batch_operations.py:35-56`

Read-modify-write pattern with no locking. If two requests read, modify, and save
concurrently, the second write silently overwrites the first.

**Fix**: Implement optimistic locking with a version/timestamp field, or use Redis
WATCH/MULTI/EXEC for atomic updates.

---

### TD-005: Zero Test Coverage

No test files exist anywhere in the project. No unit tests, integration tests, or
regression tests for auth, security, storage fallback, batch transactions, or any business
logic.

**Fix**: Add a `tests/` directory with pytest. Priority areas:
- `app/services/storage.py` — Redis/in-memory fallback behavior
- `app/services/auth.py` — JWT validation and bypass logic
- `app/utils/security.py` — path validation functions
- `app/services/batch_operations.py` — transaction semantics
- `app/routes/town.py` — CRUD endpoint behavior

---

## High — Significant Quality/Security Risks

### TD-006: No Rate Limiting or Request Size Limits

**Files**: `app/main.py:60-66`

Only CORS middleware is configured. No rate limiting, no request body size limits. Batch
endpoints and save endpoints accept unbounded payloads.

**Fix**: Add `slowapi` or `fastapi-limiter` for rate limiting. Configure request body size
limits in the ASGI server or via middleware.

---

### TD-007: SSRF in Proxy Request

**Files**: `app/services/django_client.py:270`

`proxy_request()` constructs URLs from user-controlled `path` parameter, potentially
bypassing domain validation in `validate_api_url()`.

**Fix**: Validate the fully-constructed URL (not just the base) against the allowlist.
Reject paths containing `..`, `//`, or scheme changes.

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

---

### TD-010: Global `window.*` Pollution (JavaScript)

State scattered across `window` properties instead of a centralized store:
- `main.js:21-22,53,57-58` — `window.wasmUpdateSpatialGrid`, `window.deltaTime`,
  `window.elapsedTime`, `window.__TOKEN`, `window.__BASE_PATH`
- `network.js:146,168-172` — `window.currentTownId`, `window.currentTownName`,
  `window.currentTownDescription`, `window.currentTownLatitude`,
  `window.currentTownLongitude`
- `ui.js:454-462` — reads all of these scattered `window.current*` values

**Fix**: Centralize into `state/app-state.js` (which already exists but is underused).
Migrate all `window.current*` reads/writes to getter/setter functions.

---

### TD-011: Collision Detection Duplicated 3 Ways (JavaScript)

Three independent implementations with slightly different logic:
- `models/collision.js:19-37` — WASM fallback pattern
- `controls.js:240-257` — embedded collision detection
- `physics/car.js:65` — car collision logic

**Fix**: Consolidate into `models/collision.js` as the single source of truth. Other
modules should import and call it.

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

---

### TD-014: Debug Logging Hardcoded for All Environments

**Files**: `app/main.py:16`

`logging.basicConfig(level=logging.DEBUG)` regardless of environment. Debug logs can
expose sensitive info and degrade performance.

**Fix**: Set log level based on `settings.environment`:
```python
log_level = logging.DEBUG if settings.environment == "development" else logging.INFO
```

---

### TD-015: Snapshots Have No Redis Fallback

**Files**: `app/services/snapshots.py:58-61`

Raises an exception if Redis is unavailable, unlike `storage.py` which has an in-memory
fallback. Feature completely breaks without Redis.

**Fix**: Implement an in-memory fallback using a deque (matching the pattern in
`history.py`).

---

### TD-016: JavaScript Memory Leaks

- `scene/scene.js:85-97` — Environment map texture assigned to `window.__envMapTexture`
  and never disposed
- `controls.js:235,302` — Creates new `THREE.Box3()` and `THREE.Vector3()` every frame in
  collision detection instead of reusing
- `collaborative-cursors.js:139-146` — Disposes geometry/material but doesn't remove
  sprites from scene first

**Fix**: Hoist reusable Three.js objects to module scope. Dispose environment textures on
scene teardown. Remove objects from scene before disposing.

---

### TD-017: WASM Initialization Race Conditions (JavaScript)

- `main.js:18-29` — Polls 50 times with backoff; silently continues if WASM never loads
- `scene.js:118-129` — Polls WASM with hardcoded 10s timeout
- `scene/scene.js:142-146` — 100ms `setTimeout` for environment texture

**Fix**: Replace polling with a Promise-based readiness signal. WASM loader should resolve
a global promise that dependents can `await`.

---

### TD-018: SSE Reconnection Can Create Parallel Connections

**Files**: `static/js/network.js:28-80`

Closure captures `retryDelay` and `evtSource`. Multiple reconnect attempts could create
parallel connections without closing old ones.

**Fix**: Track connection state explicitly. Close any existing `EventSource` before
creating a new one. Add a `connecting` guard flag.

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

---

### TD-020: Unvalidated Sort/Filter Fields in Query Service

**Files**: `app/services/query.py:198-202`, `app/models/schemas.py:203`

`sort_by` accepts arbitrary field names with no whitelist. Filter operators accept
arbitrary strings.

**Fix**: Whitelist allowed sort fields. Use `Literal` type for operators.

---

## Low — Code Quality & Best Practices

### TD-021: Dead/Unused Code

- `app/utils/normalization.py:43-76` — `denormalize_to_layout_list()` acknowledged unused
  in its own docstring
- `static/js/models/loader.js:331-363` — `preloadModel()` exported but never imported
- `static/js/collaborative-cursors.js:191-193` — `getActiveCursorUsers()` never called
- `static/js/category_status.js:258-274` — `removeStatusColor()` never called

**Fix**: Remove dead code or add `// TODO: integrate` markers if planned for future use.

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

### TD-023: Hardcoded Magic Numbers

Python:
- `events.py:66-67,75` — `timeout=10.0` repeated
- `history.py:15` — `MAX_HISTORY_SIZE = 100`
- `snapshots.py:15` — `MAX_SNAPSHOTS = 50`

JavaScript:
- `scene.js:47-49` — `SPATIAL_GRID_UPDATE_INTERVAL`, `CURSOR_UPDATE_INTERVAL`,
  `FRUSTUM_CULLING_THRESHOLD`
- `controls.js:50,92-96,106-107` — orbit speed, FOV ranges, movement speeds

**Fix**: Move Python constants to `config.py` as settings. Keep JS constants but document
their purpose.

---

### TD-024: Sensitive Data in Logs

**Files**: `app/services/django_client.py:285-291`

Logs POST request payloads at DEBUG level which could contain sensitive information.

**Fix**: Redact or truncate payload logging. Never log auth tokens or user data.

---

### TD-025: Accessibility Gaps (JavaScript)

- Toast notifications lack proper ARIA beyond generic `role="alert"`
- Joystick controls have zero keyboard accessibility
- Collaborative cursors are visual-only with no screen reader support
- Category status legend uses colors only without text alternatives

**Fix**: Add `aria-live="polite"` regions, keyboard alternatives for touch controls, and
text labels alongside color indicators.

---

## Priority Matrix

| Priority | ID | Description | Effort |
|----------|----|-------------|--------|
| P0 | TD-001 | Add `zstandard` dependency | 5 min |
| P0 | TD-002 | Fix path traversal in static file handlers | 30 min |
| P0 | TD-003 | Add `asyncio.Lock` to global mutable state | 1-2 hr |
| P1 | TD-004 | Implement optimistic locking for batch ops | 2-3 hr |
| P1 | TD-006 | Add rate limiting middleware | 1-2 hr |
| P1 | TD-007 | Fix SSRF in proxy request | 1 hr |
| P1 | TD-008 | Replace `Any` types with concrete schemas | 2-3 hr |
| P1 | TD-010 | Centralize JS state management | 3-4 hr |
| P2 | TD-005 | Add pytest test suite for critical paths | 4-8 hr |
| P2 | TD-009 | Extract shared Python helpers | 2-3 hr |
| P2 | TD-011 | Consolidate collision detection | 2-3 hr |
| P2 | TD-012 | Split god objects into focused modules | 4-6 hr |
| P2 | TD-013 | Standardize API error responses | 1-2 hr |
| P2 | TD-014 | Environment-based log levels | 30 min |
| P2 | TD-016 | Fix JS memory leaks | 2-3 hr |
| P2 | TD-017 | Promise-based WASM initialization | 1-2 hr |
| P2 | TD-018 | Fix SSE reconnection logic | 1 hr |
| P3 | TD-015 | Add snapshot Redis fallback | 1-2 hr |
| P3 | TD-019 | Add schema field validators | 1-2 hr |
| P3 | TD-020 | Whitelist sort/filter fields | 1 hr |
| P3 | TD-021 | Remove dead code | 1 hr |
| P3 | TD-022 | Standardize JS module patterns | 2-3 hr |
| P3 | TD-023 | Move magic numbers to config | 1-2 hr |
| P3 | TD-024 | Redact sensitive log data | 30 min |
| P3 | TD-025 | Accessibility improvements | 3-4 hr |
