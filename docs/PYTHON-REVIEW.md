# Python Code Review: Town Builder

**Date:** 2026-03-21
**Scope:** All Python source files under `app/`

## Overall Assessment

The codebase is **well-structured** with clean separation of concerns (routes/services/models/utils). Security is taken seriously with SSRF prevention, path traversal protection, and JWT auth. The code is generally readable and well-documented. Below are the issues found, ordered by severity.

---

## Critical Issues

### 1. Race Conditions in Town Data Mutations

**Files:** `app/routes/town.py:62, :400, :470`, `app/routes/buildings.py` (throughout)

Most route handlers follow a read-modify-write pattern without any locking:

```python
town_data = await get_town_data()    # read
town_data[category].pop(i)           # modify
await save_and_broadcast(town_data)  # write
```

Between `get_town_data()` and `set_town_data()`, another concurrent request can read stale data, causing **lost updates**. The batch operations service (`batch_operations.py:41`) correctly uses `_batch_lock`, but none of the regular CRUD routes in `town.py` or `buildings.py` use it. This is the most critical bug — in a multiplayer app, concurrent edits will silently overwrite each other.

**Fix:** Add locking (or use Redis transactions) around all read-modify-write cycles in route handlers.

### 2. Deprecated `datetime.utcnow()`

**File:** `app/services/auth.py:100`

```python
expire = datetime.utcnow() + timedelta(hours=expires_hours)
```

`datetime.utcnow()` has been deprecated since Python 3.12 and produces naive datetimes.

**Fix:**
```python
expire = datetime.now(datetime.UTC) + timedelta(hours=expires_hours)
```

### 3. Pydantic Settings Bypassed by Manual `os.getenv()`

**File:** `app/config.py:28-63`

Every field uses `os.getenv()` as its default, completely bypassing Pydantic Settings' env var loading:

```python
environment: str = os.getenv("ENVIRONMENT", "development")
jwt_secret_key: str = os.getenv("JWT_SECRET_KEY", "")
```

This defeats the purpose of `pydantic_settings.BaseSettings`, which automatically reads environment variables. The correct pattern is:

```python
environment: str = "development"  # pydantic-settings reads ENVIRONMENT automatically
jwt_secret_key: str = ""
```

Additionally, `model_config = ConfigDict(extra="allow")` on the Settings class means any typo in env vars silently becomes an extra attribute rather than raising an error.

**Fix:** Remove `os.getenv()` wrappers; let `BaseSettings` handle env vars natively.

---

## High Severity

### 4. In-Memory Fallback Storage Not Safe for Concurrent Mutations

**File:** `app/services/storage.py:86-87`

```python
async with _storage_lock:
    return copy.deepcopy(_town_data_storage)
```

The `deepcopy` protects the stored reference, but callers then **mutate the returned dict** (e.g., `town_data[category].pop(i)`) and pass it back to `set_town_data`. If two requests get copies simultaneously, the second write obliterates the first. See issue #1.

### 5. `search_town_by_name` Vulnerable to Query Parameter Injection

**File:** `app/services/django_client.py:124`

```python
search_url = f"{base_url}?name={town_name}"
```

The `town_name` is not URL-encoded. A name containing `&` or `=` could inject additional query parameters.

**Fix:** Use `httpx`'s `params` argument:
```python
resp = await client.get(base_url, headers=headers, params={"name": town_name}, timeout=5.0)
```

### 6. Error Detail Leaks Internal State

**Files:** `app/routes/town.py:228-231`, and similar patterns in other routes

```python
raise HTTPException(
    status_code=500, detail={"status": "error", "message": str(e)}
)
```

`str(e)` can expose file paths, stack traces, or database connection strings to API consumers.

**Fix:** Return generic error messages in production; log the full exception server-side only.

---

## Medium Severity

### 7. Unused Import

**File:** `app/routes/town.py:5`

```python
import os
```

`os` is imported but never used in `town.py`.

### 8. MIME Type `.d.ts` Match Doesn't Work

**File:** `app/utils/static_files.py:55`

```python
case ".d.ts":
    media_type = "text/plain"
```

`Path.suffix` returns only the **last** suffix. For `foo.d.ts`, `.suffix` is `".ts"`, not `".d.ts"`. This case will never match.

**Fix:** Check `.suffixes` or the full filename instead of `.suffix`.

### 9. `_version` Key Leaks into Town Data

**File:** `app/services/batch_operations.py:76`

```python
_data_version += 1
town_data["_version"] = _data_version
```

This internal version counter gets persisted to Redis and broadcast to all clients via SSE. It pollutes the data model and will show up in API responses, file saves, and snapshots.

**Fix:** Store version separately or strip `_version` before broadcast/persistence.

### 10. Snapshot `delete_snapshot` Always Returns `True` with Redis

**File:** `app/services/snapshots.py:210`

The Redis path always returns `True` even if the snapshot ID didn't exist. The in-memory path correctly checks the count difference, but the Redis path doesn't verify whether the key actually existed before deletion.

**Fix:** Check `redis_client.delete()` return value (returns number of keys deleted).

### 11. `get_scene_stats` Hardcodes Categories

**File:** `app/routes/scene.py:56-66`

```python
stats = {
    "buildings": len(town_data.get('buildings', [])),
    "vehicles": len(town_data.get('vehicles', [])),
    ...
}
```

The `CATEGORIES` constant exists in `app/utils/normalization.py` but isn't used here. If a category is added to `CATEGORIES`, this route will silently omit it.

**Fix:** Iterate over `CATEGORIES` instead of hardcoding.

### 12. `verify_token` Doesn't Handle `credentials is None`

**File:** `app/services/auth.py:59`

```python
def verify_token(credentials: ...):
    return verify_token_string(credentials.credentials)
```

Since `security = HTTPBearer(auto_error=False)`, `credentials` can be `None`. `verify_token` will raise `AttributeError` instead of a proper 401. Only `get_current_user` handles the `None` case.

**Fix:** Add a `None` check or set `auto_error=True` on `HTTPBearer` if `verify_token` is meant to always require credentials.

---

## Low Severity / Style

### 13. f-strings in Logging Calls

**Files:** Throughout the codebase

```python
logger.info(f"Updated town name to: {data['townName']}")
logger.warning(f"Redis initialization failed: {e}")
```

These evaluate the f-string even when the log level is disabled.

**Fix:** Prefer lazy formatting:
```python
logger.info("Updated town name to: %s", data['townName'])
```

### 14. `list_buildings` Uses `str = None` Instead of `str | None = None`

**File:** `app/routes/buildings.py:79`

```python
async def list_buildings(category: str = None, ...):
```

Should be `category: str | None = None` for correct type annotation.

### 15. Inconsistent ID Generation

**Files:**
- `app/routes/buildings.py:41` — `uuid.uuid7().hex[:8]` (truncated, collision risk at scale)
- `app/services/batch_operations.py:163` — `str(uuid.uuid4())` (full UUID)
- `app/services/snapshots.py:49` — `str(uuid.uuid7())`

Truncating UUIDs to 8 hex chars gives only ~4 billion possibilities, which is fine for a town builder but inconsistent with the rest of the codebase.

**Fix:** Pick one strategy and use it consistently.

### 16. `generate_natural_description` Has Repetitive Code

**File:** `app/services/scene_description.py:105-188`

The same pattern (check count > 0, format model descriptions) is repeated for every category. This could use a loop over a configuration list.

### 17. `save_town` Saves Raw Data to File but Normalized Data to Redis

**File:** `app/routes/town.py:129-150`

```python
canonical_town_data = normalize_layout_data(town_data_to_save)  # normalized
await f.write(json.dumps(town_data_to_save, indent=2))          # raw
await save_and_broadcast(canonical_town_data, ...)               # normalized
```

The local file gets the un-normalized data while Redis gets the normalized version. Loading from file vs. loading from Redis can produce different data shapes.

**Fix:** Write `canonical_town_data` to the file as well.

### 18. `httpx.AsyncClient` Created Per-Request

**File:** `app/services/django_client.py` (throughout)

Every Django API call creates and destroys an `httpx.AsyncClient`:

```python
async with httpx.AsyncClient() as client:
    resp = await client.get(...)
```

This prevents HTTP connection reuse.

**Fix:** Consider a module-level or app-scoped client for connection pooling.

---

## What's Done Well

- **Security utilities** (`app/utils/security.py`) — thorough path traversal prevention, SSRF protection, and proxy path validation
- **Clean architecture** — routes delegate to services, Pydantic models for validation, clear module boundaries
- **Redis fallback** — graceful degradation to in-memory storage when Redis is unavailable
- **SSE implementation** — proper keepalive, user tracking, and cleanup on disconnect
- **Normalization** — `normalize_layout_data` handles multiple input shapes (list-of-objects, dict-of-categories) robustly
- **Compression** — zstd for Redis storage and snapshots
- **Health probes** — proper `/healthz` and `/readyz` endpoints for Kubernetes deployments

---

## Summary of Recommended Fixes (Priority Order)

| Priority | Issue | Fix | Status |
|----------|-------|-----|--------|
| **P0** | Race conditions in CRUD routes | Add locking around read-modify-write cycles | **FIXED** — `town_data_lock` in storage.py, used by town.py + buildings.py |
| **P0** | Settings bypass `pydantic_settings` | Remove `os.getenv()` wrappers; let BaseSettings handle env vars | **FIXED** — config.py rewritten, `extra="ignore"` |
| **P1** | Query param injection in `search_town_by_name` | Use `params=` kwarg instead of f-string | **FIXED** |
| **P1** | Error messages leak internals | Return generic messages in production | **FIXED** — town.py returns "Internal server error" |
| **P1** | Deprecated `datetime.utcnow()` | Use `datetime.now(UTC)` | **FIXED** — auth.py + all test files |
| **P2** | `.d.ts` MIME matching broken | Check `.suffixes` or stem | **FIXED** — checks `.suffixes[-2:]` |
| **P2** | `_version` pollutes town data | Store version separately or strip before broadcast | **FIXED** — stripped before save/broadcast |
| **P2** | File saves raw vs. Redis saves normalized | Normalize before file write | **FIXED** — writes `canonical_town_data` |
| **P2** | Snapshot delete always returns True | Check Redis delete return value | **FIXED** — checks `deleted_count` |
| **P2** | `verify_token` missing None check | Add guard or change `auto_error` | **FIXED** — None check added |
| **P2** | Unused `import os` in town.py | Remove unused import | **FIXED** |
| **P2** | Hardcoded categories in scene stats | Use `CATEGORIES` constant | **FIXED** |
| **P3** | f-string logging, type hints, style | Incremental cleanup | **PARTIAL** — fixed in modified routes |
| **P3** | Per-request httpx client | Use shared client with connection pooling | Deferred |
| **P3** | Inconsistent ID generation | Standardize on one UUID strategy | Deferred |
