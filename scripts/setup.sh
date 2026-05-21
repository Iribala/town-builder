#!/bin/bash
# Setup script for Town Builder development environment

set -e

echo "================================"
echo "Town Builder - Development Setup"
echo "================================"
echo ""

# Check Go version
echo "Checking Go version..."
if ! command -v go &> /dev/null; then
    echo "❌ Go not found! Install Go 1.26+ from https://golang.org/dl/"
    exit 1
fi

GO_VERSION=$(go version | awk '{print $3}')
echo "✓ $GO_VERSION found"
echo ""

# Check Kukicha (optional — only needed for editing .kuki sources; brewed .go files are committed)
echo "Checking Kukicha (optional)..."
if command -v kukicha &> /dev/null; then
    KUKICHA_VERSION=$(kukicha version 2>&1 | awk '{print $NF}')
    echo "✓ kukicha $KUKICHA_VERSION found"
else
    echo "⚠️  kukicha not found. Required only if you edit .kuki sources."
    echo "   Install from https://github.com/kukichalang/kukicha/releases"
fi
echo ""

# Check Redis
echo "Checking Redis..."
if command -v redis-cli &> /dev/null; then
    if redis-cli ping > /dev/null 2>&1; then
        echo "✓ Redis is running"
    else
        echo "⚠️  Redis is installed but not running"
        echo "   Start Redis with: redis-server"
    fi
else
    echo "⚠️  Redis not found. Install Redis for multiplayer features."
    echo "   Ubuntu/Debian: sudo apt-get install redis-server"
    echo "   macOS: brew install redis"
fi
echo ""

# Sync Go modules
echo "Syncing Go modules..."
go mod download
echo "✓ Go modules ready"
echo ""

# Create .env file
if [ ! -f .env ]; then
    echo "Creating .env file from template..."
    cp .env.example .env
    echo "✓ Created .env file"
    echo ""
    echo "⚠️  IMPORTANT: Edit .env and set your configuration!"
    echo "   Especially in production:"
    echo "   - JWT_SECRET_KEY (generate with: openssl rand -hex 32)"
    echo "   - ALLOWED_ORIGINS"
else
    echo "✓ .env file already exists"
fi
echo ""

# Create data directory
mkdir -p data/towns
echo "✓ Created data directory"
echo ""

echo "================================"
echo "Setup complete!"
echo "================================"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your configuration"
echo "2. Start Redis: redis-server"
echo "3. Run development server: ./scripts/dev.sh"
echo "   or: go run ./cmd/server"
echo ""
echo "Access the application at: http://127.0.0.1:5001/"
