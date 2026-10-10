# Build stage — compile the Kukicha-brewed Go server to a static binary
FROM golang:1.27 AS builder
WORKDIR /src

# Install kukicha: it materializes the stdlib that go.mod references via a
# `replace` directive (kukicha init) and brews the .kuki sources into the
# .go files that go build consumes (scripts/brew.sh). The brewed .go files
# are gitignored build artifacts, so a fresh checkout has none of them.
# The module is hosted at kukicha.org (mirroring tangled.org).
RUN go install kukicha.org/kukicha/cmd/kukicha@v0.85.9

# Copy module files first for better layer caching, then materialize the
# stdlib replacement target before `go mod download`.
COPY go.mod go.sum ./
COPY . .
RUN kukicha init > /dev/null
RUN go mod download

# Transpile every .kuki source into Go, then build the physics WASM module
# the frontend loads (also gitignored, rebuilt here from physics_wasm.kuki).
RUN ./scripts/brew.sh
RUN ./build_wasm.sh

RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /town-server ./cmd/server

# Runtime stage — distroless (no shell; ca-certificates included)
FROM gcr.io/distroless/static-debian12
WORKDIR /app

COPY --from=builder --chown=65532:65532 /town-server /app/town-server
COPY --from=builder --chown=65532:65532 /src/static    /app/static
COPY --from=builder --chown=65532:65532 /src/templates /app/templates

EXPOSE 5001
USER 65532
ENTRYPOINT ["/app/town-server"]
