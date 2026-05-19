module github.com/duber000/town-builder

go 1.26.1

toolchain go1.26.2

// This module leverages Go 1.26 features:
// - Swiss Tables: 30-60% faster map operations
// - Green Tea GC: Standardized in Go 1.26
// - Improved small object allocation
// - Better stack allocation for slices

require (
	github.com/klauspost/compress v1.17.9
	github.com/kukichalang/kukicha/stdlib v0.19.0
	github.com/redis/go-redis/v9 v9.7.0
)

require (
	github.com/cespare/xxhash/v2 v2.2.0 // indirect
	github.com/dgryski/go-rendezvous v0.0.0-20200823014737-9f7001d12a5f // indirect
	golang.org/x/text v0.26.0 // indirect
)

replace github.com/kukichalang/kukicha/stdlib => ./.kukicha/stdlib
