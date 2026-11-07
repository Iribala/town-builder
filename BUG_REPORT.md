# BUG REPORT: `kukicha brew` cross-package field resolution depends on brewed `.go` output, breaking fresh checkouts

- **Date observed:** 2026-10-10
- **kukicha version:** v0.85.10 (also present in v0.85.9)
- **Go toolchain:** 1.27.1
- **Project affected:** town-builder (`scripts/brew.sh`, Docker/CI image build)

## Summary

`kukicha brew <dir>` resolves **function calls** on imported sibling packages
from their `.kuki` exports, but resolves **field access on a cross-package
type alias** through the live Go package loader — which reads the sibling
package's *brewed `.go` output on disk*. On a fresh checkout, where the
gitignored `.go` artifacts do not exist yet, brewing packages in
non-dependency order (e.g. the alphabetical order `scripts/brew.sh` used)
fails with misleading diagnostics that point at the consumer's test file
rather than the unbreaded dependency.

## Reproduction

From a fresh clone of this repo (zero `.go` files on disk — they are
gitignored build artifacts):

```console
$ kukicha init && go mod download
$ kukicha brew internal/normalization
```

`internal/normalization` imports `github.com/Iribala/town-builder/internal/object`
and aliases its type:

```kuki
# normalization.kuki
import "github.com/Iribala/town-builder/internal/object"
type Vec3 = object.Vec3
```

`normalization_test.kuki` then accesses fields through the alias
(`pos.X`, `pos.Y`, `pos.Z` — lines 131/169 etc.). With
`internal/object/main.go` absent, brew fails:

```
── ERROR ───── /src/internal/normalization/normalization_test.kuki:131:37 ──
[semantic/unknown-field] type normalization.Vec3 has no field X
    │
131 │             test.AssertEqual(t, pos.X, 5.0)
    │                                     ^      (likewise Y and Z)
```

Notes on the reproduction:

- The **non-test source brews fine** — `normalization.kuki` only calls
  `object.Vec3FromAny(...)`, which resolves from the `.kuki` exports — so
  the failure looks like a broken test file, not a missing dependency.
- `internal/object` sorts **after** `internal/normalization` alphabetically,
  so the previous `for d in $(find ... | sort -u)` loop in `scripts/brew.sh`
  could never satisfy the dependency on a fresh tree.
- The same brew succeeds on a developer workstation **only because stale
  brewed `.go` files from earlier sessions already sit next to the `.kuki`
  sources**. This is why the breakage surfaced in CI/Docker (fresh
  checkout) and not in day-to-day local use.

## Root cause

Field resolution on the aliased value type goes through the live Go
package machinery (`internal/semantic/go_stdlib_live.go`,
`loadLivePkgByPath` → `go/internal/gcimporter` — the same code path that
panics on Go 1.27 export data in kukicha ≤ v0.85.9). That path reads the
sibling package as a **Go package**, so it needs the brewed `.go` (or
compiled export data) — the `.kuki` source alone is not consulted.

An aggravating factor: `internal/project/crosspackage.go`
(`extractDirEnvironmentWithImports`) deliberately treats a sibling that
yields no exports as "no exports available" rather than an error ("a
single broken sibling doesn't sink the whole consumer build"), so a
dependency that is merely *not brewed yet* is indistinguishable from a
dependency with a genuinely broken source.

## Workaround (in this repo)

`scripts/brew.sh` (commit ca28679) now brews in convergence passes: each
pass brews every package whose dependencies are already on disk and
defers the rest, looping until a pass makes no progress — at which point
the failing packages are re-brewed with diagnostics visible. In practice
one extra pass resolves the tree (pass 1 brews `internal/object`; pass 2
brews `internal/normalization`).

## Suggested fixes in kukicha

Any one of these would remove the need for the workaround:

1. Resolve cross-package type **fields** from the sibling's `.kuki`
   source the same way function signatures are resolved, so brewing
   does not depend on pre-existing `.go` output.
2. Make directory/recursive brew dependency-ordered (topological) over
   in-repo imports.
3. At minimum, emit a diagnostic when a cross-package import resolves to
   a package with no exports (or no brewed `.go`) — e.g. "cannot resolve
   fields of type object.Vec3: internal/object has no brewed output" —
   instead of `unknown-field` errors at the consumer's use sites.
