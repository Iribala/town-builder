module github.com/Iribala/town-builder

go 1.26.4

// This module leverages Go 1.26 features:
// - Swiss Tables: 30-60% faster map operations
// - Green Tea GC: Standardized in Go 1.26
// - Improved small object allocation
// - Better stack allocation for slices

require (
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/google/uuid v1.6.0
	github.com/klauspost/compress v1.17.9
	github.com/redis/go-redis/v9 v9.7.0
)

require (
	codeberg.org/kukichalang/kukicha/stdlib v0.52.0
	github.com/cespare/xxhash/v2 v2.2.0 // indirect
	github.com/dgryski/go-rendezvous v0.0.0-20200823014737-9f7001d12a5f // indirect
	golang.org/x/text v0.37.0 // indirect
)

replace codeberg.org/kukichalang/kukicha/stdlib => ./.kukicha/stdlib
