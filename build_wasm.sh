#!/bin/bash

# ============================================================================
# WASM Build Script - Town Builder Physics Module
# Optimized for Go 1.26+ with Swiss Tables and GreenTea GC
# ============================================================================

set -e  # Exit on error

echo "================================================"
echo "Town Builder WASM Build Script"
echo "Go 1.26+"
echo "================================================"
echo ""

# Check Go version
GO_VERSION=$(go version | awk '{print $3}')
echo "Go version: $GO_VERSION"

# Verify Go 1.26+
if [[ ! $GO_VERSION =~ go1\.(2[6-9]|[3-9][0-9]) ]]; then
    echo "⚠ Warning: Go 1.26+ required. Current version: $GO_VERSION"
    echo "  Build may fail with older Go versions."
    echo ""
fi

# Create output directory
mkdir -p static/wasm
mkdir -p static/js

# ============================================================================
# Build Physics WASM Module (Swiss Tables enabled by default in Go 1.24)
# ============================================================================

echo "Building physics WASM module with Go 1.26+ optimizations..."
echo ""
echo "Enabled Features:"
echo "  ✓ Swiss Tables (default in Go 1.24+)"
echo "    - 30% faster map access"
echo "    - 35% faster map assignment"
echo "    - 10-60% faster map iteration"
echo "  ✓ GreenTea Garbage Collector (standard in Go 1.26+)"
echo "    - 10-40% reduction in GC overhead"
echo "    - Better locality and CPU scalability"
echo "    - Reduced pause times for WASM"
echo "  ✓ Improved small object allocation"
echo "  ✓ Better stack allocation for slices"
echo "  ✓ Enhanced mutex performance (SpinbitMutex)"
echo "  ✓ Car physics (acceleration, steering, friction)"
echo "  ✓ Optimized for WASM runtime"
echo ""

# Build with optimized settings
GOOS=js GOARCH=wasm go build \
  -ldflags="-s -w" \
  -o static/wasm/physics_greentea.wasm \
  physics_wasm.go

PHYSICS_SIZE=$(du -h static/wasm/physics_greentea.wasm | cut -f1)
echo "✓ Physics WASM build complete: static/wasm/physics_greentea.wasm ($PHYSICS_SIZE)"
echo "  Includes: Spatial grid, collision detection, car physics"
echo ""

# ============================================================================
# Copy WASM Exec Runtime
# ============================================================================

echo "Copying Go WASM runtime..."
# Try multiple possible locations
WASM_EXEC_LOCATIONS=(
    "$(go env GOROOT)/misc/wasm/wasm_exec.js"
    "$(go env GOROOT)/lib/wasm/wasm_exec.js"
)

COPIED=false
for WASM_EXEC_SRC in "${WASM_EXEC_LOCATIONS[@]}"; do
    if [ -f "$WASM_EXEC_SRC" ]; then
        cp "$WASM_EXEC_SRC" static/js/wasm_exec.js
        echo "✓ wasm_exec.js copied to static/js/ from $WASM_EXEC_SRC"
        COPIED=true
        break
    fi
done

if [ "$COPIED" = false ]; then
    echo "⚠ Warning: wasm_exec.js not found in any standard location"
fi
echo ""

# ============================================================================
# Build Summary
# ============================================================================

echo "================================================"
echo "Build Summary"
echo "================================================"
echo ""
echo "Physics WASM Module:"
echo "  File: static/wasm/physics_greentea.wasm"
echo "  Size: $PHYSICS_SIZE"
echo "  Go Version: $GO_VERSION"
echo "  GC: GreenTea (standard in Go 1.26+)"
echo ""
echo "Optimizations (enabled in Go 1.26+):"
echo "  ✓ Swiss Tables - 30-60% faster map operations"
echo "  ✓ GreenTea GC - improved GC overhead and pause behavior"
echo "  ✓ SpinbitMutex - Enhanced lock performance"
echo "  ✓ Improved allocation - Better small object handling"
echo "  ✓ Stack optimization - Reduced heap pressure"
echo ""
echo "Features:"
echo "  ✓ Spatial grid collision detection (O(k) vs O(n²))"
echo "  ✓ Car physics (acceleration, steering, friction)"
echo "  ✓ Object queries (nearest, radius-based)"
echo ""

echo "JavaScript API Functions:"
echo "  Collision Detection:"
echo "  • wasmUpdateSpatialGrid(objects)      - Update spatial grid"
echo "  • wasmCheckCollision(id, bbox)        - Single collision check"
echo "  • wasmBatchCheckCollisions(checks)    - Batch collision check"
echo ""
echo "  Object Queries:"
echo "  • wasmFindNearestObject(x, y, cat, d) - Find nearest by category"
echo "  • wasmFindObjectsInRadius(x, y, r, c) - Radius-based search"
echo ""
echo "  Car Physics:"
echo "  • wasmUpdateCarPhysics(state, input)  - Update car physics (NEW)"
echo ""
echo "  Debugging:"
echo "  • wasmGetGridStats()                  - Debug statistics"
echo ""
echo "Performance Tips:"
echo "  • Pre-size maps to reduce rehashing (already optimized in code)"
echo "  • Use batch operations for multiple collision checks"
echo "  • Spatial grid auto-optimizes for O(k) collision detection"
echo ""
echo "================================================"
echo "Build complete! 🚀"
echo "================================================"
