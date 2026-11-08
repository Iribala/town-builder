#!/bin/bash
# Start the development server (Kukicha backend via go run)

set -e

echo "Starting Town Builder development server..."
echo "Server will be available at http://127.0.0.1:5001/"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  Warning: .env file not found!"
    echo "Creating .env from .env.example..."
    cp .env.example .env
    # The template ships secure-by-default: JWT auth enabled with an empty
    # key. Generate a throwaway development key so the server boots locally.
    if grep -q '^JWT_SECRET_KEY=$' .env && command -v openssl &> /dev/null; then
        DEV_KEY=$(openssl rand -hex 32)
        perl -0pi -e "s/^JWT_SECRET_KEY=$/JWT_SECRET_KEY=${DEV_KEY}/m" .env
        echo "✓ Generated a development JWT_SECRET_KEY"
    else
        perl -0pi -e 's/^DISABLE_JWT_AUTH=false$/DISABLE_JWT_AUTH=true/m' .env
        echo "⚠️  openssl not found; set DISABLE_JWT_AUTH=true for local dev"
    fi
    echo "✓ Created .env file. Please review and update it with your configuration."
    echo ""
fi

# Check if Redis is running
if ! redis-cli ping > /dev/null 2>&1; then
    echo "⚠️  Warning: Redis is not running!"
    echo "Multiplayer features will not work without Redis."
    echo "Start Redis with: redis-server"
    echo ""
fi

# Transpile .kuki sources to Go (required before go run)
"$(dirname "$0")/brew.sh"

# Start the development server
exec go run ./cmd/server
