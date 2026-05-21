# Town Builder Architecture

This document provides a comprehensive overview of the Town Builder codebase structure, designed to help developers (including AI assistants) quickly understand and navigate the project.

## Table of Contents

- [Overview](#overview)
- [Technology Stack](#technology-stack)
- [Backend Architecture](#backend-architecture)
- [Frontend Architecture](#frontend-architecture)
- [Data Flow](#data-flow)
- [Key Concepts](#key-concepts)
- [File Organization](#file-organization)
- [API Endpoints](#api-endpoints)
- [Configuration](#configuration)

## Overview

Town Builder is a real-time multiplayer 3D town building application with:
- **Backend**: Kukicha (transpiled to Go) with Redis for state management
- **Frontend**: Three.js for 3D rendering, vanilla JavaScript
- **WASM**: Kukicha (compiled via Go 1.26+) for high-performance physics calculations
- **Multiplayer**: Server-Sent Events (SSE) with Redis Pub/Sub

## Technology Stack

### Backend
- **Kukicha** - Readable language transpiled to Go (sources in `*.kuki`, brewed `.go` files committed alongside)
- **Go 1.26+** - Underlying runtime (`net/http.ServeMux` with Go 1.22+ method patterns, no chi)
- **Redis 7.1.0+** - In-memory data store for state sharing
- **github.com/golang-jwt/jwt/v5** - JWT authentication
- **github.com/redis/go-redis/v9** - Redis client
- **github.com/klauspost/compress/zstd** - Compression

### Frontend
- **Three.js r181** - 3D rendering engine
- **Vanilla JavaScript** - No framework dependencies
- **WebAssembly** - Kukicha-compiled WASM for physics
- **Server-Sent Events** - Real-time updates

### Deployment
- **Docker** - Containerization
- **Kubernetes** - Orchestration
- **Valkey/Redis** - State storage

## Backend Architecture

### Application Structure

```
cmd/server/main.kuki        # HTTP server bootstrap (config, storage, router, listen)
internal/
├── config/                 # Settings loaded from .env (with SetForTest helper)
├── models/schemas.kuki     # Value types for request/response payloads
├── normalization/          # Layout-data shape coercion (map-of-categories ↔ list)
├── storage/                # Redis primary + in-memory fallback
├── pubsub/                 # Redis Pub/Sub fan-out for SSE
├── middleware/
│   ├── bodylimit/          # MaxRequestBodyBytes enforcement
│   └── cors/               # Origin allowlist
├── routes/                 # API endpoint handlers
│   ├── router/             # NewMux() — central route registration
│   ├── ui/                 # HTML template rendering
│   ├── auth/               # JWT auth endpoints
│   ├── models/             # 3D model listing
│   ├── town/               # Town CRUD
│   ├── buildings/          # Programmatic building CRUD
│   ├── scene/              # Scene description / stats
│   ├── proxy/              # Django API proxy (SSRF-protected)
│   ├── events/             # SSE endpoint
│   ├── cursor/             # Multiplayer cursor positions
│   ├── batch/              # Batch operations (programmatic API)
│   ├── query/              # Spatial queries
│   ├── history/            # Undo/redo
│   ├── snapshots/          # Town snapshots
│   ├── static/             # Static file serving
│   ├── common/             # Shared helpers
│   └── health/             # /healthz, /readyz
├── services/               # Business logic layer
│   ├── auth/               # JWT token generation/validation
│   ├── django_client/      # External Django API client
│   ├── model_display_names/
│   ├── model_loader/       # 3D model file discovery
│   ├── batch/              # Batch operations manager
│   ├── query/              # Spatial queries & filtering
│   ├── history/            # Operation history
│   ├── snapshots/          # Snapshot versioning
│   ├── scene_description/  # Natural-language scene summary
│   └── town_helpers/       # Shared town manipulation helpers
└── utils/
    ├── geometry/           # AABB and spatial math
    └── security/           # Path-traversal + SSRF prevention + JWT helpers
```

### Layered Architecture

```
┌─────────────────────────────────────────┐
│          Routes (API Handlers)          │  - HTTP request handling
│        internal/routes/*/               │  - Input validation
└─────────────────────────────────────────┘  - Response formatting
                  │
                  ▼
┌─────────────────────────────────────────┐
│      Services (Business Logic)          │  - Core functionality
│        internal/services/*/             │  - Data transformation
└─────────────────────────────────────────┘  - External integrations
                  │
                  ▼
┌─────────────────────────────────────────┐
│      Storage & External Systems         │  - Redis operations
│   Redis, Django API, File System        │  - File I/O
└─────────────────────────────────────────┘  - External API calls
```

### Key Backend Modules

#### `cmd/server/main.kuki`
- Application initialization
- Config load, storage init, CORS + bodylimit middleware, route registration
- Listen on port 5001

#### `internal/config/`
- Environment variable loading (.env)
- Singleton settings + `SetForTest(s)` for test injection
- Security configurations (JWT, CORS, SSRF allowlist)

#### `internal/storage/`
- Abstract storage interface
- Redis implementation for multiplayer state
- In-memory fallback when Redis unavailable
- Town data persistence (Redis + optional JSON files via `/api/town/save`)

#### `internal/pubsub/`
- Event publishing to Redis Pub/Sub
- SSE connection management
- User presence tracking
- Broadcast system for multiplayer updates

#### `internal/services/auth/`
- JWT token validation and decoding
- Optional authentication bypass (development)

## Frontend Architecture

### Module Structure

```
static/js/
├── api-error-handler.js # Global fetch error handling
├── main.js              # Application entry point & initialization
├── scene.js             # Main scene orchestrator
├── scene/
│   └── scene.js        # Three.js scene setup & management
├── models/
│   ├── loader.js       # GLTF model loading with caching
│   ├── placement.js    # Placement indicator & grid snapping
│   └── collision.js    # Bounding box collision detection
├── physics/
│   └── car.js          # Vehicle movement & physics
├── utils/
│   ├── wasm.js         # WebAssembly initialization
│   ├── physics_wasm.js # Physics WASM wrapper
│   ├── raycaster.js    # Mouse picking & raycasting
│   └── disposal.js     # Three.js memory cleanup
│   ├── device-detect.js # Mobile detection helpers
│   └── haptics.js       # Mobile vibration helpers
├── controls.js          # Camera & keyboard controls
├── ui.js               # UI state management & event handlers
├── network.js          # SSE client & multiplayer sync
└── collaborative-cursors.js # Show other users' cursors
├── category_status.js   # Category-based status overlays
├── joystick.js          # Mobile driving joystick
└── mobile/              # Mobile UI, settings, tutorial
```

### Frontend Data Flow

```
User Input
    │
    ▼
┌─────────────────┐
│   UI Layer      │  ui.js - Handle button clicks, mode changes
└─────────────────┘
    │
    ▼
┌─────────────────┐
│  Scene Layer    │  scene.js - Orchestrate operations
└─────────────────┘
    │
    ├──▶ Model Placement (placement.js)
    ├──▶ Collision Detection (collision.js)
    ├──▶ Physics Calculation (car.js, WASM)
    └──▶ Network Sync (network.js)
    │
    ▼
┌─────────────────┐
│  Three.js       │  Render 3D scene
└─────────────────┘
```

### Key Frontend Modules

#### `main.js`
- Application initialization
- WASM module loading
- Scene creation
- Error handling setup

#### `scene.js`
- Central coordinator for all scene operations
- Mode management (place/edit/delete/drive)
- Object placement and manipulation
- Save/load functionality

#### `models/loader.js`
- GLTF model loading with THREE.GLTFLoader
- Model caching to avoid duplicate loads
- Error handling for missing models
- Progress callbacks

#### `models/collision.js`
- Bounding box calculations
- Collision detection between objects
- Ground plane detection
- WASM integration for performance

#### `network.js`
- SSE connection management
- Reconnection with exponential backoff
- Client-side sync for SSE updates and save/load calls

#### `utils/wasm.js`
- WASM readiness helper

## Data Flow

### User Placement Flow

```
1. User clicks "Place" mode
   └─▶ ui.js updates mode state

2. User selects model from sidebar
   └─▶ scene.js loads model via loader.js
   └─▶ Creates placement indicator

3. User moves mouse
   └─▶ raycaster.js detects ground position
   └─▶ placement.js updates indicator position
   └─▶ collision.js checks for overlaps (via WASM)

4. User clicks to place
   └─▶ scene.js adds object to scene
   └─▶ UI triggers API save/update (`/api/town` or `/api/town/save`)
   └─▶ backend saves to Redis and broadcasts SSE updates

5. Other clients receive update
   └─▶ network.js receives SSE event
   └─▶ scene.js places object in their scene
```

### Multiplayer State Sync

```
Client A                    Backend                    Client B
   │                           │                          │
   │──[Place Object]──────▶    │                          │
   │                           │                          │
   │                    [Save to Redis]                   │
   │                           │                          │
   │                    [Publish to Pub/Sub]              │
   │                           │                          │
   │                           │────[SSE Event]──────▶    │
   │                           │                          │
   │                           │                    [Update Scene]
```

## Key Concepts

### Modes

The application has several operational modes:

- **Place Mode**: Select and place objects on the ground
- **Edit Mode**: Click objects to adjust position/rotation
- **Delete Mode**: Click objects to remove them
- **Drive Mode**: Control vehicles with WASD/arrows

### Object Structure

Each placed object has:
```javascript
{
    id: "unique-id",
    model: "model-name",
    position: { x, y, z },
    rotation: { x, y, z },
    scale: { x, y, z },
    category: "buildings|vehicles|roads|etc"
}
```

### Storage Strategy

- **Redis**: Primary storage for multiplayer state (if available)
- **Local Files**: Backup storage in `data/` directory
- **Memory**: In-memory cache for fast access

### WASM Physics Module

Kukicha WASM module provides:
- Spatial grid for O(k) collision detection
- Batch collision checking
- Nearest neighbor queries
- Radius-based object searches

API functions:
- `wasmUpdateSpatialGrid(objects)`
- `wasmCheckCollision(id, bbox)`
- `wasmBatchCheckCollisions(checks)`
- `wasmFindNearestObject(x, y, category, maxDist)`
- `wasmFindObjectsInRadius(x, y, radius, category)`
- `wasmUpdateCarPhysics(x, y, rotation, speed, steering, deltaTime)`
- `wasmGetGridStats()`

## File Organization

### Configuration Files

- `.env` - Environment variables (gitignored)
- `.env.example` - Environment variable template
- `go.mod` - Go module dependencies
- `Dockerfile` - Container build instructions
- `.gitignore` - Git ignore patterns

### Static Assets

```
static/
├── js/              # JavaScript modules
├── models/          # 3D GLTF models
│   ├── buildings/
│   ├── park/
│   ├── props/
│   ├── street/
│   ├── trees/
│   └── vehicles/
├── wasm/            # WebAssembly modules
│   └── physics_greentea.wasm
└── css/             # Stylesheets
```

### Templates

```
templates/
└── index.html       # Main application HTML (Go html/template)
```

### Data Storage

```
data/
└── *.json           # JSON files for town saves (gitignored)
```

## API Endpoints

### Authentication
- No auth token generation endpoints (tokens are issued externally)

### Models
- `GET /api/models` - List available 3D models by category
- `GET /api/model/{category}/{model_name}` - Fetch a model or metadata (`?info=1`)

### Buildings
- `POST /api/buildings` - Create a building (programmatic)
- `GET /api/buildings` - List buildings (optionally filtered by category)
- `GET /api/buildings/{building_id}` - Get building by ID
- `PUT /api/buildings/{building_id}` - Update building by ID
- `DELETE /api/buildings/{building_id}` - Delete building by ID

### Town Management
- `GET /api/town` - Get current town data
- `POST /api/town` - Update town data (name/driver/full)
- `POST /api/town/save` - Save town data (local + optional Django)
- `POST /api/town/load` - Load latest town data (local)
- `GET /api/town/load-from-django/{town_id}` - Load town from Django
- `DELETE /api/town/model` - Delete a model by category/id
- `PUT /api/town/model` - Edit a model by category/id
- `GET /api/config` - Client configuration

### Multiplayer
- `GET /events` - SSE endpoint for real-time updates
- `POST /api/cursor/update` - Update user cursor position

### Proxy (Django Integration)
- `GET /api/proxy/towns` - Proxy to external Django API

### UI
- `GET /` - Main application page
- `GET /healthz` - Liveness check
- `GET /readyz` - Health check endpoint

### Scene
- `GET /api/scene/description` - Natural language scene summary
- `GET /api/scene/stats` - Scene statistics

### Programmatic APIs (Claude Integration)

Medium-level APIs for programmatic interaction and AI-driven automation:

**Batch Operations:**
- `POST /api/batch/operations` - Execute multiple create/update/delete/edit operations atomically

**Spatial Queries:**
- `POST /api/query/spatial/radius` - Find objects within radius from center point
- `POST /api/query/spatial/bounds` - Find objects within bounding box
- `POST /api/query/spatial/nearest` - Find N nearest objects to a point

**Advanced Filtering:**
- `POST /api/query/advanced` - Execute complex queries with filters, sorting, and pagination

**History & Undo/Redo:**
- `GET /api/history` - Get operation history
- `POST /api/history/undo` - Undo last operation
- `POST /api/history/redo` - Redo last undone operation
- `DELETE /api/history` - Clear history

**Snapshots:**
- `POST /api/snapshots` - Create snapshot of current town state
- `GET /api/snapshots` - List all snapshots
- `GET /api/snapshots/{id}` - Get snapshot data
- `POST /api/snapshots/{id}/restore` - Restore town to snapshot state
- `DELETE /api/snapshots/{id}` - Delete snapshot

See `PROGRAMMATIC_API.md` for detailed documentation and examples.

## Configuration

### Environment Variables

See `.env.example` for complete list. Key variables:

**Required in Production:**
- `JWT_SECRET_KEY` - Secret for JWT token signing
- `ALLOWED_ORIGINS` - CORS allowed origins (comma-separated)

**Optional:**
- `DISABLE_JWT_AUTH` - Bypass JWT auth (development only)
- `REDIS_URL` - Redis connection string
- `TOWN_API_URL` - External Django API URL
- `ENVIRONMENT` - `development` or `production`

### Port Configuration

- **Development & Production**: Port 5001 (single Go binary; goroutine-per-connection means no separate worker model)

### Security

- **CORS**: Configured via `ALLOWED_ORIGINS`
- **JWT**: Optional authentication for API endpoints
- **Path Traversal**: Prevented via `internal/utils/security/`
- **SSRF**: URL validation for external API calls (allowlist in `settings.AllowedApiDomains`)

## Development Workflow

### Adding a New Feature

1. **Backend**:
   - Define request/response types in `internal/models/schemas.kuki`
   - Implement business logic in `internal/services/<name>/<name>.kuki`
   - Create route handler in `internal/routes/<name>/<name>.kuki`
   - Register route in `internal/routes/router/router.kuki`
   - Brew the `.kuki` files to refresh committed `.go` (see `docs/plans/kukicha-port.md` "Build pipeline")

2. **Frontend**:
   - Add UI controls in `static/js/ui.js`
   - Implement logic in appropriate module
   - Update scene orchestration in `static/js/scene.js`
   - Add network sync if needed in `static/js/network.js`

3. **Testing**:
   - Write `<name>_test.kuki` next to the subject and brew it
   - `go test ./internal/...` for the full suite
   - Manual testing in browser; check console for errors; test multiplayer with multiple windows

### Debugging Tips

- **Backend Logs**: Watch `go run ./cmd/server` output for errors
- **Frontend Logs**: Check browser Developer Console
- **Network**: Use browser Network tab for API calls
- **Redis**: Use `redis-cli monitor` to watch events
- **WASM**: Check console for WASM loading errors (non-critical)

## Performance Considerations

### Backend
- Redis connection pooling (go-redis defaults are fine)
- Goroutine-per-connection (no async/await ceremony)
- SSE fan-out via Redis Pub/Sub

### Frontend
- Model caching (avoid re-loading same models)
- WASM for collision detection (faster than JS)
- Three.js object pooling for reused geometries
- Raycasting optimization (limit objects checked)

### Network
- SSE for server-push (more efficient than polling)
- Redis Pub/Sub for inter-process communication
- Batch collision checks to reduce WASM overhead

## Security

See `docs/SECURITY_FIXES.md` for detailed security information.

Key protections:
- Path traversal prevention for file operations
- SSRF prevention for external API calls
- CORS restrictions
- Optional JWT authentication
- Input validation in route handlers (typed via `internal/models/schemas.kuki`)

## Deployment

### Local Development
```bash
go run ./cmd/server
```

### Production (Docker)
```bash
docker build -t town-builder .
docker run -p 5001:5001 town-builder
```

### Kubernetes
```bash
kubectl apply -f k8s/
```

See `k8s/` directory for deployment manifests.

## Common Patterns

### Adding a New API Endpoint

```kukicha
# 1. Define types in internal/models/schemas.kuki
type MyRequest struct
    Data string `json:"data"`

type MyResponse struct
    Result string `json:"result"`

# 2. Create service in internal/services/my_service/my_service.kuki
petiole my_service

func ProcessData(data: string) (string, error)
    # business logic
    return result, empty

# 3. Create route in internal/routes/my_route/my_route.kuki
petiole my_route

func Handler(w: http.ResponseWriter, r: reference http.Request)
    var req models.MyRequest
    json.ParseInto(body, reference of req) onerr return
    result, err := my_service.ProcessData(req.Data)
    httphelper.JSONOK(w, models.MyResponse{Result: result})

# 4. Register in internal/routes/router/router.kuki
mux.HandleFunc("POST /api/my/action", my_route.Handler)
```

### Adding a Frontend Feature

```javascript
// 1. Add UI in static/js/ui.js
export function initMyFeature() {
    const button = document.getElementById('my-button');
    button.addEventListener('click', handleMyFeature);
}

// 2. Implement in new module static/js/my_feature.js
export async function handleMyFeature() {
    // Feature logic
    const result = await callAPI();
    updateScene(result);
}

// 3. Wire up in static/js/main.js
import { initMyFeature } from './my_feature.js';
initMyFeature();
```

## Resources

- [Kukicha](https://github.com/kukichalang/kukicha) — language reference
- [Go net/http](https://pkg.go.dev/net/http) — standard library HTTP
- [Three.js Documentation](https://threejs.org/docs/)
- [Go WebAssembly Wiki](https://github.com/golang/go/wiki/WebAssembly)
- [Redis Documentation](https://redis.io/documentation)

---

For questions or clarifications, see CONTRIBUTING.md or open an issue.
