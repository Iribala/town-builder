#!/bin/bash
# Transpile every .kuki source in the tree into Go so the standard
# `go build` / `go test` toolchain can resolve cross-package imports.
#
# Kukicha's `kukicha build <dir>` only transpiles one package at a time,
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

# Every directory that contains at least one .kuki source.
dirs=$(find cmd internal -type f -name '*.kuki' -print0 \
    | xargs -0 -n1 dirname \
    | sort -u)

# Brew in passes until convergence. Cross-package type resolution loads a
# sibling's brewed .go output, so a package can only brew once its
# dependencies have been brewed — alphabetical order alone does not
# guarantee that on a fresh checkout (e.g. normalization uses
# object.Vec3 fields, but internal/object sorts after it). Each pass
# brews every package whose dependencies are already on disk and defers
# the rest; the loop terminates when a pass makes no progress, which
# means a package genuinely fails to brew.
remaining="$dirs"
prev_count=-1
for attempt in 1 2 3 4 5; do
    failed=""
    for d in $remaining; do
        if kukicha brew "$d" > /dev/null 2>&1; then
            echo "brew: $d"
        else
            failed="$failed $d"
        fi
    done
    [ -z "$failed" ] && break
    count=$(echo "$failed" | wc -w)
    if [ "$count" -eq "$prev_count" ]; then
        echo "❌ no progress brewing:$failed" >&2
        for d in $failed; do
            echo "── diagnostics for $d ──" >&2
            kukicha brew "$d" > /dev/null
        done
        exit 1
    fi
    prev_count=$count
    remaining="$failed"
done

# Top-level WASM file needs a real build tag so go build ignores it but
# the WASM toolchain picks it up.
if [ -f physics_wasm.kuki ]; then
    echo "brew: physics_wasm.kuki (--build-tag 'js && wasm')"
    kukicha brew --stdout --build-tag "js && wasm" physics_wasm.kuki > physics_wasm.go
fi

echo "✓ all .kuki sources transpiled"
