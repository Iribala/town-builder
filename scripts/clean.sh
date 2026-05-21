#!/bin/bash
# Clean script for removing generated files and caches

set -e

echo "Cleaning Town Builder project..."
echo ""

# Go build cache / test cache
echo "Cleaning Go build & test caches..."
go clean -cache -testcache 2>/dev/null || true
echo "✓ Go caches cleared"
echo ""

# Compiled server binary
echo "Removing compiled binary..."
rm -rf bin/ 2>/dev/null || true
echo "✓ bin/ removed"
echo ""

# Extracted Kukicha stdlib (re-extracted by `kukicha init`)
echo "Removing extracted Kukicha stdlib..."
rm -rf .kukicha/ 2>/dev/null || true
echo "✓ .kukicha/ removed"
echo ""

# Optional: Clean WASM builds (uncomment if needed)
# echo "Removing WASM builds..."
# rm -f static/wasm/*.wasm 2>/dev/null || true
# echo "✓ WASM builds removed"
# echo ""

# Optional: Clean saved towns (BE CAREFUL!)
# echo "⚠️  Do you want to remove saved towns? (y/N)"
# read -r response
# if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
#     rm -f data/towns/*.json 2>/dev/null || true
#     echo "✓ Saved towns removed"
# else
#     echo "Saved towns preserved"
# fi
# echo ""

echo "Cleanup complete!"
