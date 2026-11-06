#!/bin/bash
# Run the frontend JavaScript unit tests (Node's built-in test runner).

set -e

cd "$(dirname "$0")/.."

if ! command -v node > /dev/null 2>&1; then
    echo "❌ Error: node is not installed."
    echo "   Install Node.js 20+ to run the frontend tests."
    exit 1
fi

echo "Running frontend JavaScript tests..."
exec node --test tests/js/
