# Town Builder – Copilot Instructions

## Commands

```bash
# Install dependencies
uv sync

# Development server (port 5001, auto-reload)
uv run uvicorn app.main:app --reload --port 5001
# or
./scripts/dev.sh

# Production server (port 5000, Gunicorn + gevent)
./scripts/prod.sh

# Run all tests
uv run pytest

# Run a single test
uv run pytest tests/test_town_routes.py::TestSaveTown::test_save_with_town_id_patches

# Rebuild Go WASM module (only after modifying physics_wasm.go)
./build_wasm.sh
```

## Architecture

Town Builder is a real-time multiplayer 3D town builder. Three layers communicate:

- **Backend** – FastAPI (Python 3.14+) following a strict `Routes → Services → Storage` layering. Routes handle HTTP; services hold all business logic; `app/services/storage.py` abstracts Redis (primary) with an in-memory dict fallback when Redis is unavailable.
- **Frontend** – Vanilla JavaScript + Three.js (no framework). `static/js/scene.js` is the central orchestrator; `static/js/ui.js` handles DOM events; `static/js/network.js` manages SSE reconnection.
- **Physics WASM** – `physics_wasm.go` compiles to `static/wasm/physics_greentea.wasm`. Exposes a spatial-grid collision system and car physics as global JS functions (`wasmUpdateSpatialGrid`, `wasmCheckCollision`, `wasmBatchCheckCollisions`, `wasmUpdateCarPhysics`, etc.). WASM loading is non-critical; the app degrades gracefully if it fails.

**Multiplayer flow:** client POST → backend saves to Redis → publishes to Redis Pub/Sub channel `town_events` → SSE endpoint (`GET /events`) fans out to connected clients.

## Key Conventions

### Layout data normalization
Town data arrives in two shapes (dict-of-categories or array-of-objects). Always pass it through `app/utils/normalization.normalize_layout_data()` before use. The canonical category list lives in `app/utils/normalization.CATEGORIES`.

### Adding a new API endpoint
1. Define request/response models in `app/models/schemas.py` (Pydantic v2).
2. Implement logic in a new `app/services/<name>.py`.
3. Create route handler in `app/routes/<name>.py` with `APIRouter(prefix="/api/...", tags=["..."])`.
4. Register the router in `app/main.py` with `app.include_router(...)`.

### Configuration
`app/config.py` exposes a singleton `settings` (Pydantic Settings). Environment variables are read from `.env`. Key variables:
- `DISABLE_JWT_AUTH=true` – bypass auth in development/tests.
- `ALLOWED_ORIGINS` – comma-separated CORS origins; defaults to localhost in development if empty.
- `ROOT_PATH` – reverse-proxy path prefix. **Do not** pass this to `FastAPI(root_path=...)` — use `settings.root_path` for template URL generation only (see comment in `app/main.py`).

### Security utilities
Use `app/utils/security.py` for any new file path operations (path-traversal prevention) or outbound HTTP calls (SSRF prevention). Allowed external domains are controlled by `settings.allowed_api_domains`.

### Testing
- Tests use `pytest-asyncio` with `asyncio_mode = "auto"` — all `async def test_*` functions are picked up automatically.
- `conftest.py` sets `DISABLE_JWT_AUTH=true` and `storage.redis_client = None` to run fully in-memory with no real Redis.
- Use the `app_client` fixture (AsyncClient via ASGITransport) for route integration tests.
- Mock external Django API calls with `respx` or `unittest.mock.patch`.

### Commit messages
Follow Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

### WASM output file
The physics module outputs to `static/wasm/physics_greentea.wasm` (not `physics.wasm`).
