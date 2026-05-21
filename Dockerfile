# Build stage — compile the Kukicha-brewed Go server to a static binary
FROM golang:1.26 AS builder
WORKDIR /src

# Install kukicha so we can extract the stdlib that go.mod references via a
# `replace` directive. We don't compile any .kuki sources here — the brewed
# .go files are committed alongside — but go.mod requires the stdlib path to
# resolve.
RUN go install github.com/kukichalang/kukicha/cmd/kukicha@v0.19.5

# Copy module files first for better layer caching, then materialize the
# stdlib replacement target before `go mod download`.
COPY go.mod go.sum ./
COPY . .
RUN kukicha init > /dev/null
RUN go mod download

# Brewed .go files are committed, so a plain `go build` works.
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /town-server ./cmd/server

# Runtime stage — minimal image with the binary + static assets
FROM alpine:latest
RUN apk add --no-cache ca-certificates
WORKDIR /app

COPY --from=builder /town-server /app/town-server
COPY --from=builder /src/static    /app/static
COPY --from=builder /src/templates /app/templates

EXPOSE 5001
ENTRYPOINT ["/app/town-server"]
