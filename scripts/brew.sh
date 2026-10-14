#!/bin/bash
# Transpile every .kuki source in the tree into Go so the standard
# `go build` / `go test` toolchain can resolve cross-package imports.
#
# Kukicha's `kukicha brew <dir>` only transpiles one package at a time,
# and multi-package Go builds need every imported package to already
# exist as .go on disk. This script bridges that — run it after cloning
# the repo or after editing any .kuki file.
#
# Outputs are gitignored (see .gitignore).

set -euo pipefail

if ! command -v kukicha &> /dev/null; then
    echo "❌ kukicha not found — install from https://github.com/kukichalang/kukicha/releases"
    exit 1
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

# Every directory that contains at least one .kuki source. Cross-package
# type fields resolve from the sibling's .kuki exports (compiler
# v0.85.11+), so an alphabetical single pass works on a fresh checkout;
# dependencies do not need to be brewed first.
dirs=$(find cmd internal -type f -name '*.kuki' -print0 \
    | xargs -0 -n1 dirname \
    | sort -u)

for d in $dirs; do
    kukicha brew "$d" > /dev/null
    echo "brew: $d"
done

# Top-level WASM file needs a real build tag so go build ignores it but
# the WASM toolchain picks it up.
if [ -f physics_wasm.kuki ]; then
    echo "brew: physics_wasm.kuki (--build-tag 'js && wasm')"
    kukicha brew --stdout --build-tag "js && wasm" physics_wasm.kuki > physics_wasm.go
fi

echo "✓ all .kuki sources transpiled"
