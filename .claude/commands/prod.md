---
description: Start the production server
---

Start the Town Builder application in production mode (compiled Go binary).

Run: `./scripts/prod.sh`

The application will be available at http://127.0.0.1:5001/

Notes:
- Builds `bin/town-server` with `-ldflags="-s -w"` if not present, then execs it
- Single binary; goroutine-per-connection (no separate worker model needed)
- Ensure Redis is running for multiplayer features
- Check that .env is configured for production (JWT_SECRET_KEY, ALLOWED_ORIGINS)
