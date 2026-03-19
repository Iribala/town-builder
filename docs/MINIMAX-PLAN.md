# Technical Review & Remediation Plan

Generated: March 2026
Review Scope: Full codebase (Python/FastAPI backend, Go WASM physics, Three.js frontend)

---

## Executive Summary

This document outlines critical architectural issues, security vulnerabilities, and technical debt identified in the Town Builder codebase. Issues are classified by severity with recommended remediation steps.

---

## Critical Issues (Fix Immediately)

### 1. Security: JWT Tokens in URL Query Parameters

**Severity:** CRITICAL  
**Files:** `app/routes/events.py:17,25-33`

JWT tokens are passed via query parameters in the SSE endpoint:
```python
async def sse_events(name: str = Query(None), token: str = Query(None)):
```

**Problem:** Tokens appear in server logs, browser history, CDN logs, and can leak via Referer headers.

**Remediation:** Use `Authorization` header with Bearer scheme instead:
```python
async def sse_events(name: str = Query(None), authorization: str = Header(None)):
    token = authorization.replace("Bearer ", "") if authorization else None
```

---

### 2. Reliability: Snapshots Require Redis with No Fallback

**Severity:** CRITICAL  
**Files:** `app/services/snapshots.py:69-71`

```python
if not redis_client:
    logger.error("Redis client not available for snapshots")
    raise Exception("Redis client not available")
```

**Problem:** Unlike town data (which has in-memory fallback), snapshots hard-fail without Redis.

**Remediation:** Implement in-memory fallback for snapshots, similar to `storage.py`.

---

### 3. Reliability: Race Condition in Connected Users

**Severity:** CRITICAL  
**Files:** `app/services/events.py:13-14,28-45`

```python
_connected_users: dict[str, float] = {}
_users_lock = asyncio.Lock()
```

`_cleanup_and_get_users()` is called inside the lock, but cleanup modifies `_connected_users` without holding the lock when called from `get_online_users()`.

**Remediation:** Ensure all access to `_connected_users` is protected by `_users_lock`.

---

### 4. Reliability: Silent Django Client Failures

**Severity:** CRITICAL  
**Files:** `app/services/django_client.py:156-161`

```python
except (httpx.HTTPError, httpx.RequestError) as e:
    logger.error(f"Error searching for town by name: {e}")
    return None  # Silently swallows all errors
```

**Problem:** Network timeouts, DNS failures, and 5xx errors all return `None` without distinguishing from "not found."

**Remediation:** Create distinct return types or raise specific exceptions for different failure modes.

---

### 5. Bug: Undefined Variable Reference

**Severity:** CRITICAL  
**Files:** `static/js/controls.js:257`

```javascript
if (!collisionDetected) {
    car.position.copy(potentialPosition);  // BUG: potentialPosition not defined
```

**Remediation:** Change `potentialPosition` to `TEMP_VECTOR`.

---

### 6. Memory Leak: Event Listeners Never Removed

**Severity:** HIGH  
**Files:** `static/js/scene.js:104-106`, `static/js/controls.js:19-25`

Event listeners added to renderer.domElement and document are never removed on cleanup.

**Remediation:** Implement cleanup functions and call them on page unload / scene disposal.

---

### 7. Memory Leak: SSE EventSource Never Closed

**Severity:** HIGH  
**Files:** `static/js/network.js:57-110`

EventSource created in `setupSSE()` is never closed when the page unloads.

**Remediation:** Add cleanup function and call it on `beforeunload`.

---

### 8. Physics: Car Physics Has No Collision Integration

**Severity:** HIGH  
**Files:** `physics_wasm.go:632-732`

`updateCarPhysics` completely ignores collision detection. Cars drive through buildings.

**Remediation:** Integrate collision checking into car physics simulation.

---

### 9. Performance: Occupancy Bits Never Cleared

**Severity:** HIGH  
**Files:** `physics_wasm.go:224-230`

When objects are removed, their occupancy bits are intentionally NOT cleared. Stale bits accumulate.

**Remediation:** Clear bits when objects are removed from the spatial grid.

---

## High Priority Issues

### 10. Maintainability: Hardcoded Category Lists

**Severity:** HIGH  
**Files:** 
- `app/utils/normalization.py:5-14`
- `app/services/storage.py:17-30`
- `app/routes/buildings.py:101,142,180,252`
- `app/routes/scene.py:57-66`
- `app/services/scene_description.py:201`
- `app/services/query.py:364-368`

Categories are duplicated across 6+ files.

**Remediation:** Define categories once in a shared constants module or enum.

---

### 11. API Design: Swiss-Army Knife `/api/town` Endpoint

**Severity:** HIGH  
**Files:** `app/routes/town.py:42-102`

Single endpoint handles three unrelated operations:
1. Town name update only (lines 64-68)
2. Driver assignment (lines 71-94)
3. Full town data update (lines 97-100)

**Remediation:** Split into separate endpoints: `/api/town/name`, `/api/town/driver`, `/api/town`.

---

### 12. DRY Violation: Duplicate Deletion Logic

**Severity:** HIGH  
**Files:**
- `app/routes/town.py:425-460`
- `app/services/batch_operations.py:269-309`

Identical "find closest model by position" logic exists in both locations.

**Remediation:** Extract to shared utility function.

---

### 13. Performance: Global Lock Contention

**Severity:** HIGH  
**Files:** `app/services/batch_operations.py:41`

```python
async with _batch_lock:
```

Global lock serializes ALL batch operations across all users.

**Remediation:** Consider per-town locks or lock-free data structures.

---

### 14. Bug: Y/Z Coordinate Confusion

**Severity:** MEDIUM  
**Files:** `static/js/utils/physics_wasm.js:109,113-114`

```javascript
return {
    x: position.x,
    y: position.z,  // Y position becomes Z in 2D grid
    bbox: {
        minY: position.z + box.min.z,  // Uses Z for Y
```

**Remediation:** Add clear comments and consider using typed arrays for bbox passing.

---

### 15. Performance: BitVector Hash Collisions

**Severity:** MEDIUM  
**Files:** `physics_wasm.go:99-121`

The `gridKeyToIndex` function uses flawed hashing causing frequent collisions.

**Remediation:** Use a better hash function (e.g., fnv, murmur3) with proper distribution.

---

## Medium Priority (Technical Debt)

### Architecture Issues

| Issue | Location | Remediation |
|-------|----------|-------------|
| Inconsistent API path prefixes | Multiple route files | Standardize to `/api/v1/` prefix |
| Cursor route path bug | `app/routes/cursor.py:7,10` | Use `@router.post('/update')` not `/api/cursor/update` |
| Inconsistent response formats | Throughout routes | Define standard response schemas |
| No API versioning | All endpoints | Add `/api/v1/` prefix |
| Global spatial grid bottleneck | `physics_wasm.go:291` | Consider grid partitioning |

### Security Issues

| Issue | Location | Remediation |
|-------|----------|-------------|
| CORS defaults include localhost | `app/config.py:61-64` | Default to empty or production URL only |
| SSRF validation uses flawed suffix match | `app/utils/security.py:145-167` | Use proper domain suffix matching |
| Generic JWT error messages | `app/services/auth.py:42-43` | Distinguish expired vs invalid vs malformed |

### Memory Management (Go WASM)

| Issue | Location | Remediation |
|-------|----------|-------------|
| No sync.Pool for objects | Multiple `make()` calls | Pool frequently allocated slices |
| findNearestObject is O(n) | `physics_wasm.go:495-511` | Use spatial grid radius query |
| No finalizers | `physics_wasm.go` | Add SetFinalizer for cleanup |
| GreenTea GC flag missing | `build_wasm.sh:54-57` | Add `GOEXPERIMENT=greenteagc` |

### Frontend Memory Leaks

| Issue | Location | Remediation |
|-------|----------|-------------|
| CanvasTexture not disposed | `collaborative-cursors.js:74,175` | Add texture.dispose() |
| Screen reader element not removed | `collaborative-cursors.js:109-122` | Remove from DOM on cleanup |
| Legend elements accumulate | `ui.js:129-130` | Remove previous legend before adding |

---

## Low Priority (Code Quality)

| Issue | Location |
|-------|----------|
| Duplicate import | `app/main.py:10,14` |
| wasmUpdateCarPhysics not exposed to JS | `physics_wasm.js` / `physics_wasm.go` |
| calcDistance not in JS required functions | `physics_wasm.js:50` |
| Blocking prompt on init | `main.js:50-53` |
| Magic numbers | Throughout `physics_wasm.go` (8192, 16384, 10.0, 256) |
| No unit tests for Go WASM | `physics_wasm.go` |
| Mutable module-level state | `scene-state.js:1-8` |
| BloomFilter not used effectively | `models/loader.js:86-89` |

---

## Remediation Timeline

### Phase 1: Immediate (1-2 days)
1. Fix JWT in query params → use Authorization header
2. Fix undefined `potentialPosition` variable
3. Add event listener cleanup
4. Close SSE EventSource on unload
5. Add Redis fallback for snapshots

### Phase 2: Short-term (1 week)
1. Consolidate category definitions
2. Refactor `/api/town` into separate endpoints
3. Fix race condition in events.py
4. Distinguish Django client error types
5. Clear occupancy bits on object removal

### Phase 3: Medium-term (2-4 weeks)
1. Implement API versioning
2. Standardize response formats
3. Add pagination to list endpoints
4. Integrate collision into car physics
5. Add sync.Pool for WASM allocations
6. Fix BitVector hash function

### Phase 4: Long-term (Ongoing)
1. Add unit tests (Python and Go)
2. Implement grid partitioning for spatial index
3. Add capability negotiation between JS and WASM
4. Consider migration to proper domain validation library
5. Performance audit and optimization pass

---

## Appendix: File Index

### Backend (Python)
- `app/main.py` - Entry point, duplicate import issue
- `app/config.py` - CORS defaults, duplicate env loading
- `app/routes/events.py` - JWT in query params, SSE cleanup
- `app/routes/town.py` - Swiss-army knife endpoint, JSON decode
- `app/routes/buildings.py` - Duplicate category references
- `app/routes/cursor.py` - Route path bug
- `app/services/storage.py` - Inconsistent Redis failure handling
- `app/services/snapshots.py` - No Redis fallback
- `app/services/events.py` - Race condition, lock contention
- `app/services/django_client.py` - Silent failures, no connection pooling
- `app/services/batch_operations.py` - Global lock, duplicate logic
- `app/utils/security.py` - Flawed SSRF validation

### Frontend (JavaScript)
- `static/js/main.js` - Blocking prompt
- `static/js/scene.js` - Event listener leak, async animate
- `static/js/controls.js` - Undefined variable, keyboard listeners
- `static/js/network.js` - SSE EventSource leak
- `static/js/ui.js` - DOM element accumulation
- `static/js/collaborative-cursors.js` - CanvasTexture leak
- `static/js/utils/disposal.js` - Incomplete disposal
- `static/js/utils/physics_wasm.js` - Y/Z confusion, dual state flags

### Physics (Go)
- `physics_wasm.go` - Hash collisions, occupancy bits, car physics
- `build_wasm.sh` - Missing GreenTea GC flag
