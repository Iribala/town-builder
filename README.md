# Town Builder

A web-based 3D town building application with real-time multiplayer collaboration.

## Quick Start

### Prerequisites
- Go 1.26+
- Redis (for multiplayer)
- [Kukicha](https://github.com/kukichalang/kukicha) (only if editing `.kuki` sources — brewed `.go` files are committed)

### Installation
```bash
# Clone the repository
git clone https://github.com/your-repo/town-builder.git
cd town-builder

# Sync Go modules
go mod download

# Make scripts executable
chmod +x scripts/*.sh

# Run setup (creates .env, checks dependencies)
./scripts/setup.sh
```

### Running the Application

**Development mode:**
```bash
./scripts/dev.sh
# or directly: go run ./cmd/server
```
- Starts server on http://127.0.0.1:5001
- Default CORS for localhost

**Production mode:**
```bash
./scripts/prod.sh
```
- Builds `bin/town-server` (with `-ldflags="-s -w"`) and execs it
- Listens on http://127.0.0.1:5001
- Requires proper JWT configuration

## Features

- **3D Town Building**: Drag-and-drop buildings, street pieces, trees, and props
- **Real-time Multiplayer**: Collaborate with others using Server-Sent Events
- **Physics Engine**: Kukicha WASM for high-performance collision detection and car physics
- **Multiple Modes**: Place, Edit, Delete, and Drive modes
- **Save/Load**: Persist your town layouts
- **Mobile Controls**: Touch-friendly interface

## Configuration

Create a `.env` file (or use `./scripts/setup.sh`):

```env
# Required for production
JWT_SECRET_KEY=your_secure_random_string
DISABLE_JWT_AUTH=false

# Redis
REDIS_URL=redis://localhost:6379/0

# CORS (comma-separated)
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5001

# Environment
ENVIRONMENT=development

# Reverse proxy path prefix (e.g., /town-builder when behind a proxy)
ROOT_PATH=
```

**Security Note**: Never commit your `.env` file with secrets!

## Scripts

The `scripts/` directory contains helpful utilities:

- `setup.sh` - Initial setup and dependency check
- `dev.sh` - Start development server
- `prod.sh` - Build and start production server
- `check-health.sh` - System health diagnostics
- `clean.sh` - Clean build artifacts

See `scripts/README.md` for detailed usage.

## Controls

### General
- **Mouse**: Click & drag to rotate camera
- **Arrow keys/WASD**: Move camera
- **Mouse wheel**: Zoom in/out
- **Z key**: Zoom to selection

### Modes
- **Place Mode**: Select model → Click to place
- **Edit Mode**: Click object → Adjust position/rotation
- **Delete Mode**: Click object to remove
- **Drive Mode**: Click vehicle → W/↑ accelerate, S/↓ brake, A/← left, D/→ right

## Architecture

- **Backend**: Kukicha (transpiled to Go) with Redis — `net/http.ServeMux` + Go 1.22 method patterns
- **Frontend**: Three.js with vanilla JavaScript
- **Physics**: Kukicha WASM (spatial grid, collision detection, car physics)
- **Multiplayer**: Server-Sent Events + Redis Pub/Sub

Sources live in `*.kuki` files under `cmd/` and `internal/`; brewed `.go` files are committed alongside so `go test` / `go build` work without a Kukicha toolchain.

## Deployment

- **Docker**: Container build (see `Dockerfile`)
- **Kubernetes**: Full deployment manifests in `k8s/`
- **Valkey/Redis**: Required for multiplayer state

See `docs/ARCHITECTURE.md` for technical details.

## Development

### Running Tests
```bash
go test ./...
```

### Building WASM Modules
```bash
# Edit physics_wasm.kuki, then:
kukicha brew --stdout physics_wasm.kuki > physics_wasm.go
sed -i 's|^//go:build ignore$|//go:build js \&\& wasm|' physics_wasm.go
./build_wasm.sh
```
Outputs `static/wasm/physics_greentea.wasm`.

### Other tools
```bash
./scripts/check-health.sh   # System health diagnostics
./scripts/clean.sh          # Clean build artifacts and Go caches
```

## License

MIT License - See `LICENSE.md` for details.

## Credits

- Inspired by [Florian's Room](https://github.com/flo-bit/room)
- Assets from [Kaykit Bits](https://kaylousberg.itch.io/city-builder-bits)
