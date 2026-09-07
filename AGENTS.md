# Town Builder 

## Commands

```bash
# Install Go dependencies
go mod download

# Development server (port 5001)
go run ./cmd/server
# or
./scripts/dev.sh

# Production server (compiled binary)
./scripts/prod.sh

# Run all tests
go test ./...

# Run a single test
go test ./internal/routes/town/... -run TestSaveTownPatches

# Rebuild physics WASM (only after editing physics_wasm.kuki)
kukicha brew --stdout physics_wasm.kuki > physics_wasm.go
sed -i 's|^//go:build ignore$|//go:build js \&\& wasm|' physics_wasm.go
./build_wasm.sh
```

## Architecture

Town Builder is a real-time multiplayer 3D town builder. Three layers communicate:

- **Backend** – Kukicha (transpiled to Go, `net/http.ServeMux` + Go 1.22 method patterns) following a strict `Routes → Services → Storage` layering. Routes handle HTTP; services hold all business logic; `internal/storage/` abstracts Redis (primary) with an in-memory map fallback when Redis is unavailable. Sources live in `*.kuki` files; brewed `.go` files are committed alongside so `go test` / `go build` work without a build step.
- **Frontend** – Vanilla JavaScript + Three.js (no framework). `static/js/scene.js` is the central orchestrator; `static/js/ui.js` handles DOM events; `static/js/network.js` manages SSE reconnection.
- **Physics WASM** – `physics_wasm.kuki` brews to `physics_wasm.go` and compiles to `static/wasm/physics_greentea.wasm`. Exposes a spatial-grid collision system and car physics as global JS functions (`wasmUpdateSpatialGrid`, `wasmCheckCollision`, `wasmBatchCheckCollisions`, `wasmUpdateCarPhysics`, etc.). WASM loading is non-critical; the app degrades gracefully if it fails.

**Multiplayer flow:** client POST → backend saves to Redis → publishes to Redis Pub/Sub channel `town_events` → SSE endpoint (`GET /events`) fans out to connected clients.

## Key Conventions

### Layout data normalization
Town data arrives in two shapes (map-of-categories or list-of-objects). Always pass it through `internal/normalization.NormalizeLayoutData()` before use. The canonical category list lives in `internal/normalization.Categories`.

### Adding a new API endpoint
1. Define request/response types in `internal/models/schemas.kuki`.
2. Implement logic in a new `internal/services/<name>/<name>.kuki`.
3. Create route handler in `internal/routes/<name>/<name>.kuki`.
4. Register the route in `internal/routes/router/router.kuki`.

After editing any `.kuki` file, brew the `.go` next to it (see `docs/plans/kukicha-port.md` "Build pipeline" section).

### Configuration
`internal/config/config.kuki` reads settings from the process environment via `env.GetOr`/`env.GetBoolOrDefault` (`os.Getenv` under the hood). The server loads `.env` at startup: `cmd/server/main()` calls `config.LoadEnvFile(".env")` before `config.Load()`. The loader parses `KEY=VALUE` lines (skips `#` comments/blank lines, strips surrounding quotes, splits on the first `=`) and `os.Setenv`s each — **without overriding variables already in the environment** (shell/container wins; `.env` only fills gaps, like `godotenv.Load`). So real env vars (e.g. Kubernetes-injected secrets) always take precedence. `config.Load()` itself stays a pure reader so `config.SetForTest` tests are unaffected. Key variables:
- `DISABLE_JWT_AUTH=true` – bypass auth in development/tests.
- `JWT_SECRET_KEY` – required when `DISABLE_JWT_AUTH` is not `true` (the server FATALs otherwise).
- `ALLOWED_ORIGINS` – comma-separated CORS origins; defaults to localhost in development if empty.
- `ROOT_PATH` – reverse-proxy path prefix for template URL generation.

### Security utilities
Use `internal/utils/security/` for any new file path operations (path-traversal prevention) or outbound HTTP calls (SSRF prevention). Allowed external domains are controlled by `settings.AllowedApiDomains`.

### Testing
- Tests live next to their subject as `<name>_test.kuki` (brewed to `<name>_test.go`); run with `go test ./internal/...`.
- `config.SetForTest(s)` injects settings; `storage.SetClient(empty)` + `storage.ResetMemory()` give a clean in-memory store.
- `httptest.NewServer` against `router.NewMux()` is the standard pattern for route integration tests.
- Mock external Django API calls with `httptest.NewServer` returning canned JSON.

### Commit messages
Follow Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

### WASM output file
The physics module outputs to `static/wasm/physics_greentea.wasm` (not `physics.wasm`).

## Writing Kukicha

Detailed Kukicha reference (syntax, stdlib, compiler-enforced security checks, gotchas) lives in the `kukicha` skill at `.agents/skills/kukicha/SKILL.md`. It is auto-loaded when you edit `.kuki` files or use kukicha tooling.

`kukicha init` recreates this section if regenerated — leave the skill as the source of truth and replace the regenerated block with this pointer if it returns.

<!-- kukicha:start -->
## Writing Kukicha

Kukicha is a near-superset of Go: most Go compiles as-is — including `{ }` brace blocks and range loops — with a few exceptions (`case`/`default`, `chan T`, `goto`, generic `[T]` declarations, parenthesized `const ( ... )`, Go-style `type X interface { ... }` declarations, and C-style `for init; cond; post { }` loops) that have Kukicha replacements. Go-style range loops parse for migration, but `kukicha fmt` rewrites them to `for ... in`. Anonymous `struct { ... }` types and literals parse directly (`struct { field: Type }{field: value}`). Go-compat forms are for migration, not authoring: **always write Kukicha syntax** (4-space indentation, `and`/`or`/`not`, `list of T`, `onerr`, pipes, enums) and use Kukicha's stdlib (`stdlib/*`) over raw Go packages. Fall back to Go only when Kukicha has no equivalent.

Comments start with `#` (Go's `//` is not a comment in Kukicha — it lexes as two division `/` operators; the parser catches the common `// comment` slip and hints you toward `#`).

When `kukicha init` is run, this file is created and the stdlib is extracted into `.kukicha/stdlib/` — **read the `.kuki` source there for full API details** beyond this reference. On an unfamiliar project, run `kukicha context <dir>` first: it returns the petiole (Kukicha's word for Go's `package` declaration), files, entry point, imports, top-level functions/types/enums, and the right `check`/`build`/`run` commands as JSON. Cheaper than grepping the tree.

### Getting Started

```kukicha
# hello.kuki — minimal program
import "stdlib/string"

func main()
    name := "world"
    print("Hello {string.ToUpper(name)}!")
```

Run: `kukicha run hello.kuki` · Build: `kukicha build hello.kuki`

A single-file program may omit the `petiole` declaration (Kukicha's `package`), as above. A multi-file program declares it at the top of every file:

```kukicha
petiole main

import "stdlib/string"

func main()
    print(string.ToUpper("hello"))
```

`petiole` is the per-directory package name — the direct equivalent of Go's `package` declaration, not `go.mod`'s module. A module (defined by `go.mod` at the repo/workspace root) is the versioning and dependency unit; a petiole is the namespace for one directory within that module. All `.kuki` files in a directory share the same petiole name, and `kukicha build myapp/` merges them into one `main.go` under that package. Keep petiole names unique between a directory and its sub-packages: a directory build also gathers same-petiole files from subdirectories, so two `petiole main` entry points at different depths (a wasm build plus `cmd/server`, say) conflict under `build myapp/...` — give one its own petiole or build those targets individually.

**Multi-file packages:** `kukicha build myapp/` merges all `.kuki` files directly in the directory into one `main.go`. Exactly one file defines `func main()`; other files may define `func init()` for startup work (plain helper files need neither). All files share the same `petiole` declaration (or all omit it) — one petiole per directory. `*_test.kuki` files are excluded from the merge (see [Testing](#testing)).

**Overwrite guard:** a build that would write a `.go` output path already holding a file without the `// Generated by Kukicha` header (e.g. a hand-written `main.go` in a directory being converted to `.kuki`) fails with "refusing to overwrite … not a Kukicha-generated file" instead of clobbering the source — rename or delete the foreign file to proceed. Applies to directory builds, recursive builds, and the intra-module dependency transpile performed for imported sub-packages; `kukicha brew` (whose output intentionally carries no marker) overwrites as before.

### Syntax Reference

| Kukicha (write this) | Go equivalent (avoid in `.kuki` files) |
|----------------------|----------------------------------------|
| `and`, `or`, `not` | `&&`, `\|\|`, `!` |
| `equals`, `isnt` | `==`, `!=` |
| `empty` | `nil` |
| `empty list of T` | `make([]T, 0)` (lint-enforced) |
| `empty map of K to V` | `make(map[K]V)` |
| `list of string` | `[]string` |
| `map of string to int` | `map[string]int` |
| `reference User` / `reference of x` | `*User` / `&x` (statically guaranteed non-empty) |
| `optional reference User` | `*User` (may hold `empty`; must be narrowed with `isnt empty` before `dereference`) |
| `v is empty` / `v isnt empty` | `len(v) == 0` / `len(v) != 0` (for list, map, channel, string; nil checks for references/interfaces) |
| `dereference ptr` | `*ptr` |
| bare value where `reference T` is expected | `&value` (contextual reference literal — compiler inserts `&`) |
| `list of Point{{x: 1, y: 2}}` / `Config{server: {port: 8080}}` | `[]Point{Point{x: 1, y: 2}}` / `Config{server: Server{port: 8080}}` (expected-type propagation into nested `{…}`) |
| `name: Type` (params, receivers, lambdas, struct + variant fields) | `name Type` (bare; parses but warns as deprecated) |
| `func Method on t: T` | `func (t T) Method()` (accepted as Go-compat input but not idiomatic) |
| `many args: T` | `args ...T` |
| `make channel of T` | `make(chan T)` |
| `send val to ch` / `receive from ch` | `ch <- val` / `<-ch` |
| `when` / `default` | `case` / `default` |
| `# comment` | `// comment` |
| `for item in items` / `for i, v in items` | `for _, item := range items` / `for i, v := range items` |
| `for i from 0 to 10` | `for i := 0; i < 10; i++` |
| `for i from 0 through 10` | `for i := 0; i <= 10; i++` |
| `interface Reader` + indented methods | `type Reader interface { ... }` |
| 4-space indentation | `{ }` braces |

`func`/`var`/`const`/`enum` have aliases `function`/`variable`/`constant`/`enumeration`: use the short forms in production code; the long forms are for beginner tutorials only.

**`equals` and `isnt` replace every `==` and `!=` — not just nil/empty checks:** `if count equals 0`, `if name equals "admin"`, `if phase isnt enums.SETUP`. Ordering operators (`<`, `>`, `<=`, `>=`) stay symbolic. **Chained ordering comparisons** (`low <= value < high`, `high > value >= low`) are admitted for monotonic ascending (`<`/`<=`) or descending (`>`/`>=`) chains; equality/inequality and mixed-direction chains remain rejected. **Evaluation is Python's:** operands evaluate left to right, each middle operand exactly once, and the trailing operand only if every earlier comparison passed — `0 <= i < slice.Last(xs)` does not call `slice.Last` when `i` is negative. Hoist the trailing operand yourself if you need it to run unconditionally. **Arithmetic on time values works** — a Kukicha extension, since Go has no `+`/`-` on `time.Time`: through the `datetime.Time`/`datetime.Duration` transparent aliases (or Go's `time.Time`/`time.Duration` directly), `Time + Duration`, `Duration + Time`, and `Time - Duration` yield a `Time`, and `Duration * n` / `Duration / n` with an untyped integer constant stays a `Duration` — package-level constants like `time.Minute` carry their Go types, so `deadline := datetime.Now() + 5 * time.Minute` type-checks.

### Constants

```kukicha
const PI = 3.14159
const MaxRetries: int = 5
```

`const` works at the top level or inside a function body (for tunables you want visually flagged as immutable). For a group of related constants, use `enum` instead (see [Enums](#enums)) — the parenthesized `const ( ... )` form and `iota` are Go-only.

### Variables and Functions

<!-- check:skip -->
```kukicha
count := 42           # inferred type
count = 100           # reassignment

var p: reference int   # zero-value declaration — error: must initialize or use optional
var xs: list of string

func Add(a: int, b: int) int
    return a + b

func Divide(a: int, b: int) (int, error)
    if b equals 0
        return 0, error "division by zero"
    return a / b, empty

# Default parameter + named argument at call site
func Greet(name: string, greeting: string = "Hello") string
    return "{greeting}, {name}!"

result := Greet("Alice", greeting: "Hi")
files.Copy(from: src, to: dst)

quantity := 5.0
unitPrice := 10.0
discount := 0.2
total := calculateTotal(quantity: quantity, unitPrice: unitPrice, discount: discount)
```

`name: Type` is the canonical form everywhere a name binds to a type — parameters, receivers, lambda parameters, struct fields, and variant-enum payload fields. Bare `name Type` parses for Go compatibility but warns as deprecated (`kukicha fmt -w` rewrites it). `error "message"` constructs an error value (Kukicha's `errors.New`/`fmt.Errorf`); interpolation works inside the string: `error "bad value {x}"`.

Named-argument types are type-checked against their parameter types (a `f(count: "three")` where `count` is `int` is a compile error, not a silent pass). Keep the value explicit even when it has the same name as its label: write `f(count: count)`.

### Strings and Interpolation

<!-- check:skip -->

```kukicha
greeting := "Hello {name}!"          # {expr} interpolation — replaces fmt.Sprintf
json := "key: \{value\}"             # \{ \} for literal braces

# Single quotes: strictly literal, never interpolating (ideal for regex, static JSON, paths)
pattern := '^[a-z]{2,8}$'
rawJSON := '{"name": "Alice"}'
winPath := 'C:\temp\file'
escaped := 'it\'s fine'              # only \' and \\ are escapes; other \ stays verbatim

# Multi-line with interpolation — "..." with \n escapes keeps {expr}
prompt := "{preamble}\nClassify GitHub issues. Reply JSON: \{severity:1-5, kind\}\n"

# Or backticks: bare { } literal, ${expr} interpolates — ideal for HTML/regex/JSON templates
html := `<article class="card">${title}</article>`

# OS path separator — use filepath.Join (no \sep escape)
import "path/filepath"
path := filepath.Join(dir, file)

# Escape sequences: \a \b \f \n \r \t \v \\ \" \' \{ \} \xHH \uHHHH \UHHHHHHHH \0-\377 (octal)
# \xHH and octal produce RAW BYTES (Go semantics — "\xff" is byte 0xFF, and
# "\xff" equals "\377"); \uHHHH/\UHHHHHHHH produce code points, UTF-8 encoded.
# Any other escape is a compile error (matching Go).
# Number literals: 42, 0xFF, 0o755, 0b1010, 3.14
```

**Picking a string form**:
- `"..."` — cooked: one-liners with `{expr}` interpolation. Full escapes (`\n`, `\t`, `\{`, `\}`). No literal newlines.
- `'...'` — literal: single-line, non-interpolating. Only `\'` and `\\` escape; all braces, `$`, and regex escapes (`\d`, `\s`) stay literal text. Ideal for regex, JSON fragments, Windows paths.
- `` `...` `` — raw/multiline template: content with literal `{` `}` (regex, JSON templates, HTML). Interpolates `${expr}` — bare `{` `}` stay literal. No escape processing. Multi-line.

**`{` always starts interpolation** whenever a matching `}` appears before the string ends — `{a + b}`, `{user.Name}`, `{len(xs)}` all interpolate. Two traps get caught before they bite: a **top-level comma** inside `{…}` (like a regex quantifier `"{2,}"` or `"{2,3}"`) can't appear in a single Kukicha expression, so the lexer treats the whole thing as a plain literal. A **bare integer** with no comma (`"{2}"`) still interpolates the literal `2`; the `semantic/interp-bare-int` lint flags it as an almost-certainly-forgotten `\{`. `{} ` (empty) and a lone `{` also stay literal. Escape intentional literal braces with `\{` `\}`, or use backticks for brace-heavy content — `"{\"k\": \"v\"}"`-style JSON in an interpolating string is a **parse error, not literal text**, and the compiler says so with a hint naming the fix (backtick string or `stdlib/json`). For actual JSON production, use `json.String` / `json.PrettyString` instead of hand-writing JSON text — the codec avoids the interpolation rule entirely. Quoted string literals work *inside* interpolation directly — `print("{row["name"]}")` and `print("{string.ToUpper("hi")}")` both parse, no escaping of the inner quotes needed.

There are no rune literals — `'x'` is a one-character *string*, not a Go `rune`. Inline format specifiers are supported directly in string interpolation with `{expr:fmt}` syntax (e.g., `{price:.2f}`, `{count:08d}`, `{name:-20s}`). Use `fmt.Sprintf` only for dynamic format templates where the format string itself is a variable.

### Types

<!-- check:skip -->
```kukicha
type Repo
    name: string as "name"            # lowercase with alias -> auto-exported and serialized
    stars: int    as "stargazers_count"
    tags: list of string

# Defined named type (distinct from base — needs explicit conversion: UserID(42))
type UserID int

# Function type alias
type Handler func(context.Context, string) (string, error)

# Transparent type alias (type X = Y — identical types, cross-package assertions work)
type Server = mcp.Server

# Alias long multi-token types: if a type repeats 3+ times in a file or pushes
# a signature past ~100 columns, name it once.
type UserMap = map of string to reference User

func MergeUsers(primary: UserMap, secondary: UserMap, overrides: list of UserMap) UserMap

# Interface — methods listed in an indented block (not `type X interface { }`)
interface Validatable
    Validate() list of FieldError

# Embedded interfaces — compose with Go interfaces or local ones.
# A bare (possibly qualified) type name on its own line embeds that interface.
interface ReadCloser2
    io.Reader
    Closer
    Flush() int
```

Interfaces are Go interfaces with Kukicha spelling: structural satisfaction
(no `impl` declarations), `v is Iface as x` narrowing, and use as generic
constraints (`of T: Stringer`). The semantic pass checks declared method
calls on interface-typed values and verifies same-package concrete types
implement same-package interfaces at assign/pass/return sites — a missing
method or signature mismatch surfaces at `kukicha check`, not `go build`.
Methods promoted through embedded interfaces and cross-package concrete
types defer to the Go compiler. Variant enums are the closed-set story
(sum types); interfaces are the open-method-set story. The Go-style
`type X interface { ... }` declaration is rejected with a hint pointing at
the Kukicha form (or `kukicha-blend` for bulk conversion).

### Struct embedding

`embed T` in a struct body creates a Go anonymous embedded field — the
embedded type's fields and methods are promoted to the outer struct.

```kukicha
type Base
    id: int

type User
    embed Base
    name: string

# promoted field access
func example()
    u := User{id: 7, name: "Mittens"}   # `id` promoted from Base (Go 1.27 promoted-key literal)
    print(u.id, u.name)                   # 7 Mittens

# promoted methods
type Logger
    prefix: string

func Log on l: Logger(msg: string)
    print("{l.prefix}: {msg}")

type Server
    embed Logger
    port: int

func methodExample()
    s := Server{prefix: "api", port: 8080}
    s.Log("starting")                     # promoted from Logger
```

- `embed reference Base` embeds by pointer (`*Base` in Go); initialize via
  the embedded type's key: `User{Base: reference of b, name: "x"}`.
- `embed Container of T` embeds a generic instantiation.
- Direct fields shadow promoted fields (no error); two promoted fields with
  the same name from different embeddings is an ambiguous-promotion error
  (`semantic/ambiguous-promotion`).
- Embedding chains promote transitively: `AuditEntry` embedding `Record`
  embedding `Timestamp` promotes `Timestamp.created` to `AuditEntry`.
- `embed` is context-sensitive (like `list`/`map`): `embed: string` is a
  field named "embed", not an embed directive. `embed.FS` (Go stdlib) works
  as a type name.

### Optional references

`reference T` is non-nullable everywhere — params, returns, receivers, struct fields, and local vars. Use `optional reference T` for references that may legitimately hold `empty`.

- `dereference x` on an `optional` reference is an error unless x is narrowed in the current branch (`if x isnt empty`, `if x equals empty: return`, or Go-style `!= nil` / `== nil`).
- `var p: reference T` without an initializer is rejected — initialize immediately or use `optional reference T`.
- Struct literals must initialize `reference T` fields (`semantic/zero-ref-uninit`). Exception: a literal returned alongside a non-empty trailing error is exempt — `return Log{}, error "boom"` is fine because the value is dead on the error path. `return Log{}, empty` is still rejected.
- Nested fields may use Kukicha's flattened literal keys: `Config{server.port: 8080}` lowers to `Config{server: Server{port: 8080}}` before Go code generation. Sibling paths merge (`server.host` + `server.port`); do not mix a direct field (`server: value`) with one of its nested paths.
- **Contextual reference literals**: when the expected type is `reference T`, write a bare value — the compiler inserts `&`. So `reference of task` → `task` inside `list of reference Task{...}`, and `list of reference Task{t1, t2}` (not `list of reference Task{reference of t1, reference of t2}`). Drop the `reference of` whenever the surrounding type pins the reference-ness.
- **Expected-type nested literals**: the compiler threads the expected type into nested `{…}` literals, so you can drop redundant inner type prefixes — `list of Point{{x: 1, y: 2}}` (not `list of Point{Point{x: 1, y: 2}}`) and `Config{server: {port: 8080}}` (not `Config{server: Server{port: 8080}}`). Keep the prefix only when the inner literal's type genuinely differs from the expected one.
- **Calling a `reference func(...)` field needs no `dereference`** — after narrowing, write the bare call `wh.on_connect(args)`; the compiler inserts the pointer deref. `dereference wh.on_connect(args)` binds to the *receiver*, not the function pointer, and breaks on value receivers.
- **Constructors that store a closure (or `reference of local.field`) capturing the local they return must return `reference T`, not `T`** — the value return hands the caller a copy whose closure still points at the discarded original. Compile error `semantic/value-ctor-capture`; `kukicha explain semantic/value-ctor-capture` has the recipe.

<!-- check:skip -->
```kukicha
func Greet(u: reference User) string         # u is guaranteed non-empty
    return "hello " + u.Name                 # no guard needed

func LookupOr(id: int) optional reference User
    return users.Get(id) onerr empty         # may miss

caller := LookupOr(42)
if caller isnt empty
    print(dereference caller)                # narrowed → ok
```

Choosing a return signature: use `optional reference T` when absence is the only failure mode (lookups, optional config); reserve `(reference T, error)` for genuine errors (I/O, parse, network) where the message is part of the value. Mass-migrate existing code with `kukicha infer-nullable --apply <dir>` (conservative, idempotent).

### Enums

<!-- check:skip -->
```kukicha
enum Status
    OK = 200
    NotFound = 404
    Error = 500

# An explicit integer raw type declares an internal ordinal sequence.
enum Phase: int
    Queued      # 0
    Running     # 1
    Complete    # 2

func example()
    status := Status.OK    # dot access → transpiles to StatusOK

    # Exhaustiveness-checked switch (missing cases are a compile error unless `default` is present)
    switch status
        when Status.OK
            print("ok")
        when Status.NotFound, Status.Error
            print("problem")

enum Bump: string
    Patch = "patch"
    Minor = "minor"
    Major = "major"

b := ParseBump(raw) onerr panic "{error}"   # error names the bad value + the valid set
```

- Underlying type (int or string) is inferred from explicit values; all values must match. Use `enum Name: int` (or another integer type such as `int64`) for an ordinal sequence with omitted values. Without an explicit integer raw type, every value-enum case needs `= value`. Keep values explicit for database, protocol, and persisted data. Integer enums warn if no case has value 0; duplicate raw string values are a compile error.
- Auto-generated: a `String()` method, an `All<Name>() list of <Name>` iterator in declaration order (`for s in AllStatus()`; declaring your own `All<Name>` is a compile error), and — for string-valued enums — a package-level `Parse<Name>(s string) (<Name>, error)` that composes with `onerr` and auto-propagation.
- The `: string` annotation only changes `String()` to return the raw value (`"patch"`) instead of the case name (`"Patch"`); `Parse<Name>`/`All<Name>` are generated either way. It does not make the enum string-valued — the `= "json"` values do that.
- The enum *type name itself is not a value* — `x := Status` is rejected (use `Status.OK` or a conversion `Status(200)`). Same rule for plain type names and package names (`y := fmt` is rejected).
- A literal int or string assigned, returned, passed as an argument, used as a struct field, or `as`-cast to a value enum lints when it is not one of the declared cases (`semantic/enum-out-of-domain`). Covers local enums and imported string-valued stdlib enums (compared against raw wire values, e.g. `chat.MessageRole` accepts `"user"`, not `"User"`). Use `Status.OK` for known values; parse unknown string-backed values with `Parse<Name>` instead of casting raw strings. Use `--suppress-lint=enum-domain` to silence (e.g. round-tripping an unknown wire value before a `Parse` guard).

### Variant Enums (Tagged Unions)

Reach for variant enums when another language would force a sentinel value, `None`-overloading, or a `(T, ok)` pair — cases are distinguished by name and `switch` arms get exhaustiveness checking. The strongest fit is **decode-at-boundary**: parse a wire format or SSE stream once at the edge into a variant, and downstream consumers `switch`/`when` exhaustively — no string-typed `evt.Type` checks scattered across handlers. They're the wrong tool for flat SQLite rows (the schema is the contract; a string-backed or value enum on the discriminator column is simpler) and pure tag enums with no per-variant payload (value enums + `when` already fit).

<!-- check:skip -->
```kukicha
enum Shape
    Circle
        radius: float64
    Rectangle
        width: float64
        height: float64
    Point

func area(s: Shape) float64
    switch s                          # arms auto-narrow s; multiple variants may share a body (`when Circle, Rectangle`)
        when Circle
            return 3.14159 * s.radius * s.radius
        when Rectangle
            return s.width * s.height
        when Point
            return 0.0

# Single-case check with binding
if s is Circle as c
    return 3.14159 * c.radius * c.radius
```

- Cannot mix value cases (`= literal`) and variant cases in the same enum
- `is` for bool checks; `is CaseName as v` binds in `if` blocks (top-level condition only); `isnt CaseName` is the negated form (lowers to a type assertion with `!`, no binding — `isnt Case as v` is rejected because the binding would land in the branch where the case is *not* the asserted type)
- **3+ arms → use `switch x` + `when` arms** (exhaustiveness checking + auto-narrowing). Reserve `if v is X as y` for single-case binding or single-arm filters inside a `for` loop. Sequential `if v is A` / `if v is B` / `if v is C` chains are a code smell — convert to `switch`.
- Switch bindings belong on the switch, not individual arms. `switch s` auto-narrows `s`; use `switch expression as value` when the subject needs a name or a different name. `when Circle as c` is not binding syntax (in a value arm, `as` remains an ordinary cast).

A variant enum may declare type parameters with `enum Name of T and E` (use `and`, never commas — `enum X of T, E` is a compile error):

```kukicha
enum Result of T and E
    Ok
        Value: T
    Err
        Err: E

func divide(a: int, b: int) Result of int and string
    if b equals 0
        return Err{Err: "division by zero"}
    return Ok{Value: a / b}
```

- Construction (`Ok{Value: 5}`) infers type args from the surrounding return / var-decl / call-argument type — outside-in only; bare `Ok{Value: 5}` with no typed context errors with `cannot infer type parameter`. There is no explicit call-site syntax.
- Bindings substitute through automatically: in `if r is Ok as o`, `o.Value` has the concrete instantiated type.
- Cross-package variants use qualified names — `import "stdlib/result"` gives `result.Result of int and string`, `result.Ok{Value: 5}`, `r is result.Ok as o`.

### Generic Structs

Structs declare type parameters the same way: `of T` after the name, fields may use them, and methods bind them through the receiver (`reference Box of T` — the receiver's type args are the method's type params, mirroring Go's `func (b *Box[T]) Get() T`):

```kukicha
type Box of T
    value: T

func Get on b: reference Box of T() T
    return b.value

func NewBox of T(initial: T) reference Box of T
    return reference of Box of T{value: initial}
```

- Instantiate at use sites: `Box of int` in signatures, `Box of int{value: 42}` / `reference of Box of int{...}` as literals.
- Methods cannot declare their own type params on a generic receiver (Go has no generic methods), and the receiver must bind type-param names — `reference Box of int` as a receiver is a compile error, as is a bare `reference Box` when `Box` is generic.
- Constraints work as on functions: `type Sorted of T: comparable`.

### Generic Functions

Top-level functions declare type parameters with `of T` (single) or `of T and U` (multiple, `and`-separated — never commas). An optional `: Constraint` follows a type-param name; constraints reuse Go's names (`comparable`, `cmp.Ordered`), no English aliases:

```kukicha
func Map of T and R(items: list of T, transform: func(T) R) list of R
    out := empty list of R
    for item in items
        out = append(out, transform(item))
    return out

func SortedKeys of K: cmp.Ordered(m: map of K to any) list of K
    keys := empty list of K
    for k in m
        keys = append(keys, k)
    return keys
```

- Call sites infer type args from arguments in the common case (`nums |> slice.Map((x) => x * 2)` infers `T=int`, `R=int`).
- Use `f of T from x` for explicit instantiation when inference is ambiguous: `parse.ValidateJSON of User from data` (single type arg), `slice.Map of int and string from nums` (multiple).
- Go 1.27 generic methods on concrete receivers are supported: `func Method of U on r: Stack of T(...)`. The concrete-types-only caveat is inherited from Go — no interface dispatch or reflection on methods declaring their own type params.
- The stdlib is generic throughout: `slice.Map`, `slice.Filter`, `maps.Keys`, `set.From`, `sort.By`, and the rest declare real type parameters. You get back `list of int` from `nums |> slice.Map(...)`, not `list of any`.

### Methods

<!-- check:skip -->
```kukicha
func Display on todo: Todo string
    return "{todo.id}: {todo.title}"

func SetDone on todo: reference Todo       # pointer receiver
    todo.done = true
```

### Error Handling (`onerr`)

Kukicha has **automatic error propagation**: in any function that returns `error` as its last return value, a call that returns `(T, error)` where you capture only the value automatically propagates the error — Rust's `?`, but you write nothing:

<!-- check:skip -->
```kukicha
# Errors propagate automatically in error-returning functions
func LoadUsers() (list of User, error)
    data := os.ReadFile("users.json")      # auto-propagates
    users := json.ParseBytes of list of User from data  # auto-propagates
    return users                           # auto-fills trailing error
# ('f of T from x' is Kukicha's explicit type argument — Go's f[T](x))

# Explicit onerr overrides auto-propagation
config := parseConfig(data) onerr panic "bad: {error}"

# Capturing the error variable opts out
data, err := os.ReadFile(path)     # user has the error — no auto-propagation
if err isnt empty
    return defaultConfig, err
```

- Bare statement calls that return *only* `error` also auto-propagate. A bare `(T, error)` call at statement level is a compile error in user code — capture the values, or add `onerr discard` to acknowledge a best-effort call. (The stdlib itself is exempt so `fmt.Fprintf`-style calls stay quiet there.)
- **Multi-return calls can't be nested in argument position** — `parse.CSVRecords(files.ReadString("users.csv"))` and Go's multi-value-as-sole-argument form `print(divide(6, 2))` are compile errors: split into two steps, or pipe (`files.ReadString("users.csv") |> parse.CSVRecords()`).
- **Return auto-fill:** in a function whose last return is `error`, a `return` with one fewer value auto-fills the trailing `empty` — `return users` in a `(list of User, error)` function compiles; bare `return` works in error-only functions.
- **Void functions** (no error return slot) do not auto-propagate — bare error-returning calls there are a diagnostic: handle with an explicit `onerr` clause, or `onerr discard`.

`onerr` is for **fallible operations** (I/O, parsing, network, validation). For **expected absence** with a sensible default — env vars, slice index, map key, find-by-predicate, string fallback — prefer the package's `*Or` variant (`env.GetOr`, `slice.GetOr`, `slice.FirstOr`, `slice.FindOr`, `maps.GetOr`, `string.Or`): `pkg.XOr(args, default)` reads as "give me X, or this default". Typed env parsers are the deliberate exception to "Or never errors": `env.GetIntOr`, `GetBoolOr`, and `GetFloatOr` use the default when the variable is absent or empty, and return an error when a non-empty value is malformed. `env.GetOr` and `GetListOr` cannot parse-fail and return bare values. `string.Or(x, y)` replaces `if x isnt "" then x else y`; the stdlib-idiom lint (`--suppress-lint=stdlib-idiom` to silence) flags the longer form.

<!-- check:skip -->
```kukicha
region := env.GetOr("AWS_REGION", "us-east-1")             # expected absence → *Or
workers := env.GetIntOr("WORKERS", 4) onerr panic "invalid WORKERS: {error}"
apiKey := env.Get("GITHUB_TOKEN") onerr panic "{error}"    # required secret → onerr
n      := parse.Int(raw) onerr return                      # parse can actually fail → propagate
# when a default makes sense, use the *Or variant:
n      := parse.IntOr(raw, 0)
```

The caught error is always `{error}` — **never** `{err}`. Use `onerr as e` to rename.

<!-- check:skip -->
```kukicha
# Inline forms
data := fetch.Get(url) onerr panic "failed: {error}"   # stop with message
data := fetch.Get(url) onerr panic error               # stop with the error value itself
data := fetch.Get(url) onerr explain "fetching data"   # wrap (fmt.Errorf "msg: %w") + return zero values
port := getPort()      onerr 8080                      # default value
os.RemoveAll(dir)      onerr discard                   # best-effort cleanup, acknowledged
```

Bare statement-position `onerr discard` (no LHS) is the sanctioned fire-and-forget form. Value-capturing `onerr discard` (`x := f() onerr discard`) lints: it zero-fills the LHS and hides failures behind plausible-looking values.

<!-- check:skip -->
```kukicha
# Block form — for side-effect calls and control flow; alias with `onerr as e`
v := parse(item) onerr
    continue                                                   # skip in loop
result := doWork() onerr
    t.Fatalf("boom: %v", error)
    return                          # return keeps Go compiler happy after Fatalf

# `fallback EXPR[, EXPR...]` terminates an onerr block with a default value
# (use when you need side effects AND a default; expression count matches LHS slots)
setting := loadConfig(path) onerr
    print("loadConfig failed: {error} — using default")
    fallback "default-config"
```

### Pipes

<!-- check:skip -->
```kukicha
result := data |> parse() |> transform()

# Use a lambda for non-first argument piping
data |> json.WriteTo(w)   # → json.WriteTo(data, w)  # value first, no lambda

# Bare identifier as target
data |> print                     # → fmt.Println(data)

# Pipeline-level onerr — catches errors from any step
resp := fetch.Get(url) |> fetch.CheckStatus() onerr panic "{error}"

# Piped switch — expression-only (RHS of assignment or return, never a bare
# statement; use statement-form `switch x` for side-effect dispatch).
# A single-expression arm yields its value bare; `return` is required for
# multi-statement and multi-value arms.
role := user.Role |> switch
    when "admin"
        "admin"
    default
        "user"

# On a variant enum — exhaustiveness-checked; `as v` names the piped value
area := shape |> switch as v
    when Circle
        v.radius * v.radius
    when Square
        v.side * v.side

# Multi-statement arms yield with `return` — the switch compiles to an
# immediately-invoked function, so `return` produces the switch value, NOT a
# return from the enclosing function. Multi-value arms work when the enclosing
# function's return tuple matches:
func parseKind(s: string) (string, error)
    return s |> switch
        when "tick"
            return "T", empty
        default
            return "", error "unknown"

# Shorthand .Field / .Method() — pipe receiver
name := user |> .Name

# The same shorthand is an accessor lambda when a function-typed context
# supplies the receiver and result types.
names := slice.Map(users, .name)                 # u => u.name
active := slice.Filter(users, .IsActive())       # u => u.IsActive()

# Shorthand .Method() on collections dispatches to the matching stdlib
# package based on the piped value's type kind:
#   list of T  → slice.*    (xs |> .Filter(f) → slice.Filter(xs, f))
#   map of K to V → maps.*     (m |> .Keys() → maps.Keys(m))
#   string     → string.*   (s |> .ToUpper() → string.ToUpper(s))
# This is the canonical fluent pipeline form — no Go generic methods needed.
result := users
    |> .Filter(u => u.active)
    |> .Map(u => u.name)
    |> .Reverse()
```

### Control Flow

<!-- check:skip -->
```kukicha
if count equals 0
    return "empty"
else if count < 10
    return "small"

for item in items
    process(item)

# Map iteration — `for x in m` yields KEYS (matching Go and Python).
# Use the two-variable form for key + value. Named discards (`_k`, `_v`)
# make single-aspect iteration self-documenting.
for k in scores           # k = key (matches Go and Python)
    print(k)
for k, v in scores         # k = key, v = value
    print("{k}: {v}")
for k, _v in scores       # keys only (named value discard)
    print(k)
for _k, v in scores       # values only (named key discard)
    print(v)

for i from 0 to 10        # 0..9 (exclusive)
    continue
for i from 0 through 10   # 0..10 (inclusive)
    continue
for i from 10 through 0   # descending (auto-detected; works with `to` as well)
    continue

for                        # infinite loop (use break to exit)
    msg := receive from ch
    if msg equals "quit"
        break

# Iterators — `for x in <iter.Seq expr>` binds the element type (stdlib
# iterators: set.All(s), iterator.Filter(...), ParseX-style streams)
for e in set.All(ids)
    print(e)

# If-expression (ternary)
result := if condition then "yes" else "no"

# Key check + lookup — `in` for the test, index for the value
# (no semicolon init-statement, no `, ok` pair)
if key in cache
    return cache[key]

switch command
    when "fetch", "pull"
        fetchRepos()
    default
        print("Unknown: {command}")

# Type switch — `as` is optional; the subject auto-binds when it's a
# simple identifier (same unification as variant switches):
switch event
    when string
        print(event)          # event is narrowed to string in this arm
    when reference TaskEvent
        print(event.Status)   # event is narrowed to *TaskEvent
# `as` is rename sugar — use it when you want a different name:
switch event as e
    when string
        print(e)
    when reference TaskEvent
        print(e.Status)
```

### Lambdas

Parameter types are inferred from context; explicit annotations are optional.

<!-- check:skip -->
```kukicha
repos   |> slice.Filter(r => r.stars > 100)      # inferred type
entries |> sort.ByKey(e => e.name)               # keyed
entries |> sort.ByKeyDesc(e => e.stars)          # keyed descending
repos   |> sort.By((a, b) => a.stars < b.stars)  # two params

# Block lambda (multi-statement) — may contain pipe chains and onerr
db.Transaction(pool, (tx) =>
    db.TxExec(tx, "UPDATE accounts SET balance = balance - $1 WHERE id = $2", amt, fromAcct)
    db.TxExec(tx, "UPDATE accounts SET balance = balance + $1 WHERE id = $2", amt, toAcct)
    return empty
) onerr panic "transfer failed: {error}"

# Cross-package named types infer from the callback signature — no helper func needed:
retry.DoCtx(ctx, cfg, (h) =>            # h is ctxpkg.Handle, inferred
    _, err := fetch.GetCtx(h, url)
    return err
)
```

### Collections and Literals

<!-- check:skip -->
```kukicha
func example1()
    items  := list of string{"a", "b", "c"}
    noItems := empty list of string           # non-nil empty collection (prefer over make(list of T, 0))
    config := map of string to int{"port": 8080}
    last   := items[-1]    # negative indexing (-1 = last; panics if out of range — slice.GetOr for a safe default)
    delete config["port"]  # remove a key from a map

# Untyped literals — type inferred from context
func makeConfig() Config
    return {host: "localhost", port: 8080}    # inferred from return type

func example2()
    applyConfig({host: "prod", port: 443})        # inferred from parameter
```

For larger struct values (requests, config, test data), the **indented literal** form is more readable — one field per line with a trailing comma:

```kukicha
type DeployRequest
    env: string
    replicas: int
    dryRun: bool

func example3()
    req := DeployRequest{
        env: "staging",
        replicas: 3,
        dryRun: true,
    }
```

Inference works in return statements, `onerr` handlers, function arguments, assignments, struct field values, and typed list elements. Idiomatic Kukicha uses named `type` declarations (`type User \n    name: string`) and untyped literals (`{name: "Alice"}`). Anonymous struct types (`struct { name: string }`) and explicit literals parse for Go compatibility and interop.

Untyped literals also infer from their **entries** when no context types them: `row := {"name": "Bob"}` is a `map of string to string`, `{1, 2, 3}` a `list of int`. Values of mixed types are a compile error — write the explicit `map of string to any{...}` (a literal that silently becomes `map[any]any` is one `json.String` away from a runtime marshal failure). An empty `{}` with no context warns `codegen/inferred-any` and lowers to `map[any]any{}` — declare the type instead.

Struct literal field values are explicit, including when the local has the same name: `User{name: name, age: age}`. This keeps the source self-contained and mirrors named arguments.

### Comprehensions

`map of K to V for X in XS [if COND]` is the one comprehension form. It builds a map by computing a key and value for each element — the only collection transformation with no pipe equivalent.

<!-- check:skip -->
```kukicha
type User
    name: string
    active: bool
    id: int

func comprehensionExample(users: list of User)
    # map of K to V for X in XS
    byID := map of u.id to u.name for u in users

    # map of K to V for X in XS if COND  (filtered)
    activeByID := map of u.id to u.name for u in users if u.active
    print(byID)
    print(activeByID)
```

For filter+map over a slice (the former `list of EXPR for X in XS`), use a pipe chain — it reads left-to-right and the result is typed `list of T`, not `list of any`:

<!-- check:skip -->
```kukicha
import "stdlib/slice"
import "stdlib/set"

func pipeExample(users: list of User)
    names := users |> slice.Map((u) => u.name)
    activeNames := users |> slice.Filter((u) => u.active) |> slice.Map((u) => u.name)
    uniqueNames := set.From of string(users |> slice.Map((u) => u.name))
    print(names)
    print(activeNames)
    print(uniqueNames)
```

The map comprehension lowers to the generic stdlib — `map of K to V for X in XS` becomes `slice.ToMap(XS, (X) => K, (X) => V)`, so the result is `map of K to V`, not `map of any to any`. Duplicate keys are last-wins — when two elements produce the same key, the later element's value silently replaces the earlier one (use `slice.GroupBy` when duplicates must be collected). `stdlib/slice` is auto-imported; you don't need an explicit `import "stdlib/slice"` to use a map comprehension, and `kukicha fmt` round-trips the comprehension syntax. An explicit alias (`import "stdlib/slice" as sp`) is honored by the lowered calls.

### Variadic Arguments (`many`)

```kukicha
func Sum(many numbers: int) int
    total := 0
    for n in numbers
        total = total + n
    return total

func example()
    nums := list of int{1, 2, 3}
    result := Sum(many nums)    # spread a slice
```

### Type Casts and Narrowing

<!-- check:skip -->

```kukicha
n := x as int                         # type conversion

# Narrowing an any/interface value — same `is ... as` you use on variants
if v is string as s
    print("text: " + s)               # s is a string here
if v is reference Task as task
    print(task.name)
if v is ext.Vec3 as vec               # imported Go struct types narrow too
    print(vec.X)
ok := v is int                        # bool form, no binding

# Type switch for 3+ alternatives (see Control Flow)
```

Narrowing works on `any`, `error`, and interface-typed values; on a variant enum the same syntax is a case check. Go's assertion forms (`value.(string)`, `v, ok := value.(string)`) parse as Go-compat input but `is ... as` is what you write — it never panics and the binding is scoped to the branch. The two-value cast (`v, ok := x as T`) is a **compile error** — write `if x is T as v`.

Positive narrowing (`is T as v`) is **branch-scoped**: the binding lives only inside the `if` body. For guard-style control flow — where a failed check bails out and the *continuation* path needs the narrowed type (`if v isnt T ... return` then use `v` below) — `is ... as` would force nesting. There, the Go assertion form is the **sanctioned interop escape hatch**, kept explicit until it can be threaded through the flow analysis:

<!-- check:skip -->
```kukicha
schemaMap, ok := schema.(JSONObject)     # Go assertion — accepted for guard-style bail-out
if not ok
    return empty
# ... use schemaMap as JSONObject below
```

This is raw-Go interop, not idiomatic authoring — reach for it only at unresolved external boundaries (reflection over `any`, typed decoders) and only when the positive form can't express the guard without nesting.

`as` has two jobs, recognizable by what follows it. Followed by a **fresh name**, it means "…and call it that": `import "p" as q`, `is Circle as c`, `onerr as e` (`as` names a value that doesn't have a name yet). Followed by a **type or string**, it means "treated/known as": conversion (`x as int`) and the JSON field alias (`stars: int as "stargazers_count"`).

Switch binding is unified: `switch s` auto-binds the subject in every form — variant enums, type switches over `any`/interface, and piped switches all narrow the subject in-place when it's a simple identifier. `as` is optional switch-level rename sugar: `switch s as v` lets you use a different name in the arms; it is never required. A complex expression subject (`getShape()`) or piped value that isn't a bare identifier uses `as v` or a synthetic `_piped` name, since there's no shadowable name to auto-bind. Individual `when` arms never introduce bindings.

### Concurrency

<!-- check:skip -->

```kukicha
ch := make(channel of string)
send "message" to ch
msg := receive from ch

# Buffered channel — sends don't block until the buffer fills
buf := make(channel of string, 10)
go
    send "task1" to buf
    send "task2" to buf
go doWork()

# Multi-statement goroutine
go
    defer wg.Done()
    doWork()

# Select — arm bodies may be empty (omit the indented block)
select
    when receive from done
        return
    when msg := receive from ch
        print(msg)
    when send "ping" to out
        print("sent")
    default
        print("nothing ready")
```

### Defer

<!-- check:skip -->

```kukicha
defer resource.Close()

# Block form (emits defer func() { ... }())
defer
    r := recover()
    if r isnt empty
        tx.Rollback()
        panic(r)
```

### Imports and Aliases

```kukicha
import "stdlib/slice"
import "stdlib/ctx"       as ctxpkg     # when a local variable is named 'ctx'
import "stdlib/db"        as dbpkg      # when a local variable is named 'db'
import "stdlib/errors"    as errs       # when also importing Go's 'errors'
import "stdlib/json"      as jsonpkg    # when also importing 'encoding/json'
import "stdlib/string"    as strpkg     # when the bare name would be ambiguous
import "stdlib/http"      as httphelper # when also importing 'net/http'

import "github.com/jackc/pgx/v5" as pgx  # external package
```

An alias is only needed when the bare package name would actually collide in your file (a local variable or a second import) — unaliased `import "stdlib/string"` is the normal case. When you do need one, use the names above so aliased code looks the same across projects.

### Commands

```bash
kukicha init [module]         # scaffold project + extract stdlib to .kukicha/ (re-run to update after compiler upgrade)
kukicha check <target>        # validate syntax (no codegen)
kukicha build <target>        # transpile + compile to binary (binary lands in the current directory, named after the target — same convention as go build; the generated .go lands next to the source)
kukicha run <target>          # transpile + compile + run (also: kukicha run module@version to download + run)
kukicha fmt -w <target>       # format in place (use --check in CI)
kukicha context <target>      # project metadata as JSON (for agents)
kukicha context --graph <target>  # add the knowledge graph: nodes + call/import edges
kukicha context --stdlib      # stdlib API index as JSON: signatures + docs + security/deprecated/panics tags
kukicha brew <target>         # convert .kuki → standalone .go (publication only)
kukicha audit [--source=govulncheck|pkgsite|both] [--json] [--warn-only] [dir]  # vulnerability check
kukicha pack [--output dir] <skill.kuki>  # package a skill for distribution
kukicha skills add <org>/<repo>[@ref] [--skill name|--all] [--global]  # install agent skills from GitHub
kukicha skills add <module>@<version>      # install via GOPROXY (sumdb-verified)
kukicha skills list|remove|verify|update   # manage installed skills
kukicha toolchain list|install|remove|path|which <version>  # manage cached compiler versions
kukicha infer-nullable [--apply|--diff] <target>  # suggest/apply optional reference T rewrites
kukicha explain <code>        # title + summary + reproducer + fix recipe for a diagnostic code or concept/* construct (--list to enumerate)
```

Run `kukicha <cmd> --help` for flags. Common ones: `--json` (structured diagnostics on `check`/`build`/`run`/`fmt`/`audit`), `--wasm`/`--vulncheck`/`--debug` (build), `--strict`/`--strict-security` (check), `--package-context` (single-file `check`/`build` that resolves refs into sibling `.kuki` files), `--target` (build/run override). When the compiler emits a diagnostic with a stable code (e.g. `[semantic/deref-nullable]`), `kukicha explain <code>` prints the full recipe; the same command teaches language constructs via the `concept/*` namespace (`kukicha explain concept/pipes`, `concept/onerr`, `concept/variant-enums`, `concept/go-compat-lints`, `concept/raw-go-interop`, …). Run `kukicha fmt -w` before committing.

**Compiler directives** — `# kuki:...` comments attached above a declaration or statement:

```kukicha
# kuki:deprecated "msg"   # func/type/interface/enum: warn at every call/use site
# kuki:panics "msg"       # func: warn at call sites that the callee may panic; also suppresses the onerr-panic-in-library-code lint inside the function body
# kuki:security "cat"     # func: security sink; cat = sql|html|fetch|files|redirect|shell|regex
# kuki:stability "stable" # func/type/enum/interface: publish the symbol's stability class (stable|experimental|external) in `kukicha context --stdlib`
# kuki:validate "rules"   # struct field: generate Validate() (see the validate package)
# kuki:returns N          # statement: declare return-arity of an unresolvable external Go call
# kuki:embed PATTERN      # var: emit //go:embed PATTERN above `var name embed.FS` / `string` / `[]byte`
```

`# kuki:validate` rules (comma-separated in one quoted list): `nonempty`, `nonzero`, `min=N`, `max=N`, `len=N`, `email`, `url`, `regex=PATTERN`, `oneof=a|b|c`.

`# kuki:returns N` is the escape hatch when `onerr` rejects a third-party Go call with *"return signature is unknown"* — `N` counts all Go returns including the trailing `error`. Rarely needed: the Go stdlib is resolved automatically, so this is mostly for vendored third-party Go modules.

**Environment variables:** `KUKICHA_CACHE=1` (on-disk cache), `KUKICHA_JOBS=N` (parallel workers), `KUKICHA_TOOLCHAIN=local` (offline mode — refuse network on version mismatch). `kukicha build`/`run` also default `GOAMD64=v3` (AVX2/Haswell-2013+; built binaries `SIGILL` on older CPUs — set `GOAMD64=v2` for wider support). Everything else is compiler-internal. Lints can be suppressed using `--suppress-lint=...` (e.g. `shadow`, `panic`, `stdlib-idiom`, etc.).

`kukicha skills` installs SKILL.md folders from GitHub tarballs (zip-slip safe, size-capped) or GOPROXY into `.claude/skills/` and/or `.agent/skills/` — whichever exist in the current dir, or the home-dir equivalents with `--global`. Multi-skill repos require `--skill <name>` or `--all`. Honors `GITHUB_TOKEN` for private repos and rate limits.

### Project layout & build flow

**`.kuki` is the source. Commit `.kuki`, not brewed `.go`** — committed generated Go creates two sources of truth and invites hand-edits; the matching `.go` belongs in `.gitignore` (or a `gen/` output dir). Install Kukicha with a one-line `go install`. The edit loop:

```bash
kukicha check internal/foo/      # fastest: syntax + semantic, no codegen
kukicha build ./cmd/server       # transpile + go build the whole tree
kukicha run ./cmd/server         # transpile + go build + run
```

### Brewing (`kukicha brew`) — for publication, not for builds

`kukicha brew` converts `.kuki` to standalone `.go` that builds with the Go toolchain alone — for shipping a library to non-Kukicha consumers, vendoring into a non-Kukicha repo, or a one-time port. It is **not** part of the normal edit loop (`build`/`run` invoke the transpiler internally).

```bash
kukicha brew file.kuki                          # → file.go next to source (--stdout, --remove-kuki)
kukicha brew dir/                               # recommended: main.go + per-file *_test.go — the layout go test expects
kukicha brew --build-tag "js && wasm" physics.kuki > physics_wasm.go
```

Brewed standalone *programs* (a file defining `func main()`) get `//go:build ignore` by default so `go build ./...` skips them; library packages and `*_test.go` files are brewed without it. Override with `--build-tag` — don't `sed` the directive after the fact.

`kukicha context <file|dir>` emits a JSON snapshot for agents and CI: `kukicha_version`, `petiole`, `files`/`test_files`, `entry_point` (omitted for libraries), `imports`, and `functions`/`types`/`enums`/`test_functions` carrying signatures, fields, and cases — enough to write code against a package without re-reading its source (methods are excluded to keep the shape flat). `effects` lists per-function transitive security categories (sql, html, fetch, files, redirect, shell, regex). `commands` gives the right `check`/`build`/`run` invocations. Pass `--graph` to add `nodes` (package/func/method/import) and `edges` (`call`, type-resolved from the same call graph that drives effect inference; `import`). Run it once to see the exact shape.

---

### Stdlib Packages

The stdlib is extracted to `.kukicha/stdlib/` on `kukicha init` — **read the `.kuki` source there for full signatures**. For machine-readable discovery, `kukicha context --stdlib` emits the complete index as JSON: every package and symbol with signatures, doc strings, and `stability`/`security`/`deprecated`/`panics` tags. Explore it with `jq`:

```bash
kukicha context --stdlib | jq -r '.packages[] | select(.name == "slice") | .symbols[] | "\(.name)\t\(.signature)"'
```

The table below is a curated map — what each package is *for* and which form to prefer. It deliberately omits API listings; the JSON index and the package source are the complete reference. Packages deprecated for wholesale removal are omitted entirely; partial deprecations are noted inline, and the JSON index's `deprecated` tags carry the full symbol-level detail.

| Category | Packages |
|----------|----------|
| Collections & strings | `slice` — Filter/Map/Reduce/FindOr and friends; `maps` — GetOr/Keys/Merge/Invert; `set` — hash sets (Union/Intersection/ToList); `sort` — By/ByKey comparators; `string` (`as strpkg`) — helpers; `string.Or(x, y)` is the if-empty fallback; `regex` — `MustCompile` + `Pattern` methods, `MatchSafe` for untrusted patterns; `iterator` — lazy `iter.Seq` pipelines; `cast` — ToInt/ToBool/ToString (pipe `cast.ToInt() onerr`); `math` — Clamp/Round/AbsInt (raw Go `math` for Sqrt/Pow) |
| Data & encoding | `json` (`as jsonpkg`) — `Parse`/`String`/`Bytes`/`Lookup` core, `ParseInto` for layering over defaults, naming-aware `Codec`; prefer it over hand-written JSON strings; `parse` — ValidateJSON/Form/Env return `ParseResult` variants; CSV/Int/YAML scalars; `encoding` — base64/hex; `template` — compile-once text templates (**deprecated for HTML — use `stdlib/html`**); `markdown` — CommonMark+GFM `ToHTML`, compile GFM once on hot paths |
| I/O & files | `files` — read/write/list/watch; `archive` — zip/tar.gz, zip-slip + bomb safe, `ErrEntryNotFound` sentinel; `sandbox` — filesystem jail for HTTP handlers; `shell` — `Output`/`Lines` + builder; `blob` — S3-compatible object storage (S3/R2/GCS/B2) |
| HTTP & networking | `fetch` — client with retry/auth; `SafeGet`/`GetJSON` in handlers (SSRF); `http` (`as httphelper`) — server surface: `Handler`, `Request`/`Response` methods, typed `http.Status`; `html` — auto-escaping components, the `Render` sink; `netguard` — SSRF dial guards; `url` — **the home for URL work**: parse/build/escape, `CleanPath`/`IsSubpath` traversal safety; `shellguard`/`policy` — fail-closed subprocess allowlist / approval gates for agent ops |
| CLI & system | `cli` — flag/subcommand parser, typed flags; `input` — ReadLine/ReadPassword/Confirm/Choose; `table`, `color`, `term` — tty/color/width (single source of truth); `log` — leveled structured logger, `log.With` request scoping, `StartTimer`; `env` — `GetOr` bare defaults, typed `GetIntOr`/… reject malformed values; `must` — panic-on-error startup assertions; `signal` — English-named signal handling |
| Concurrency & resilience | `concurrent` — Parallel/MapE with limits + ctx variants; `bus` — in-process pub/sub with backpressure-aware observers; `ctx` (`as ctxpkg`) — context helpers (`WithTimeout` returns `Handle` by value); `retry` — backoff + circuit breaker, `DoBudget` returns a `BudgetResult` variant; `datetime` — Now/Parse/TimeAgo, `Time`/`Duration` are transparent aliases |
| Data & storage | `db` (`as dbpkg`) — SQL with struct scanning (`Query |> ScanAll of T`); `sqlite` — WAL/foreign-key defaults; `audit` — tamper-evident hash-chained decision log; `stackstate` — blob-backed deploy state for IaC programs |
| Security & crypto | `crypto` — SHA256/HMAC/HashPassword/RandomToken/SignMLDSA; `uuid`; `validate` — pipe-style + `# kuki:validate` rules; `random` — strings/choices/samples, seedable; `errors` (`as errs`) — Wrap/Opaque boundaries, `Is`/`AsType` inspection, `NewPublic` dual messages |
| DevOps | `git` — via `gh`: tags, releases, branches; `semver` |
| AI & agents | `content` — content-block variant vocabulary shared by MCP + LLM; `jsonschema` — tool schemas by hand or `jsonschema.From of Args()` from a struct; `llm` — `StreamEvent` vocabulary; provider clients `llm/chat` (AskJSON/streams), `llm/anthropic`, `llm/llmresponses` are intentionally different; `responses` — assemble function calls from Open Responses streams; `mcp` — server/client, `ToolWithOpts` for structured output; `agentevent` — normalize goose + Claude Code hook events |
| Education & games | `game` — beginner 2D games on Ebitengine |

**Which JSON decode?** Default to `json.Parse of T` for a complete document you already hold as a string (`json.ParseBytes of T` for `list of byte`) — it decodes and nothing else. Reach for `parse.ValidateJSON of T from text` only at trust boundaries where the target type carries `# kuki:validate` rules and you want accumulated validation errors alongside the value (via a `Parsed{Value, Violations}` / `Malformed{Error}` switch). `fetch.GetJSON of T from url` fetches, checks the status, and directly decodes the response body into `T` — use it whenever the JSON comes from a URL.

<!-- check:skip -->

```kukicha
# Typed JSON decode — `of T from x` is the explicit-type-arg syntax
repos := fetch.GetJSON of list of Repo from url onerr panic "{error}"

# Chat Completions tool loop; Responses and Anthropic have provider-specific builders
schema := jsonschema.Schema(list of jsonschema.Property{jsonschema.Prop("city", jsonschema.String, "City")})
    |> jsonschema.Required(list of string{"city"})
c := chat.New("openai:gpt-4o-mini")
    |> chat.AddTool("get_weather", "Get weather", schema)
    |> chat.User("Weather in Paris?")
comp := c |> chat.SendRaw onerr panic "{error}"
if chat.HasToolCalls(comp)
    handlers := empty map of string to func(string) string
    handlers["get_weather"] = (args: string) => "Sunny, 22°C"
    c = chat.ExecuteToolCalls(c, comp, handlers) onerr panic "{error}"

# MCP server tool with typed args
mcp.Tool of PriceArgs and any(server, "get_price", "Get stock price", schema,
    (args: PriceArgs) =>
        return lookupPrice(args.Symbol), empty)

# ToolWithOpts — annotation hints + enum-restricted property
schema2 := jsonschema.Schema(list of jsonschema.Property{
    {Name: "direction", Type: jsonschema.String, Description: "Sort direction", Enum: list of any{"asc", "desc"}},
}) |> jsonschema.Required(list of string{"direction"})
outputSchema := jsonschema.Schema(list of jsonschema.Property{
    jsonschema.Prop("items", jsonschema.Array, "Sorted items"),
}) |> jsonschema.Required(list of string{"items"})
mcp.ToolWithOpts of SortArgs and any(server, "sort_items", "Sort a list", schema2,
    mcp.ToolOpts{ReadOnly: true, Title: "Sort Items", OutputSchema: outputSchema},
    (args: SortArgs) =>
        return map of string to any{"items": sortItems(args.Direction)}, empty)
```

**External packages** (separate Go modules abstracted behind stdlib wrappers): `kukicha.org/blob` (S3 SDK deps, surfaced via `stdlib/blob`), `kukicha.org/game` (Ebitengine, surfaced via `stdlib/game`), `kukicha.org/stackstate` (surfaced via `stdlib/stackstate`). The wrappers import these modules, so a `go mod tidy` after `kukicha init` fetches them automatically.

---

### Security — Compiler-Enforced Checks

The compiler **flags** these patterns in HTTP handlers (functions with `http.ResponseWriter` or the `res: http.Response` wrapper) with `security/*` diagnostics that block `check`/`build`/`run` by default (`KUKICHA_LINT_SECURITY=0` downgrades them to advisory warnings; `--suppress-lint=security` silences them). Treat them as must-fix regardless:

| Pattern | Fix |
|---------|-----|
| `httphelper.HTML(w, nonLiteral)` / `res.HTML(nonLiteral)` | `SafeHTML` variant, **or** compose an `html.Fragment` and send it with `res.WriteHTML(f)` — interpolation inside the fragment is auto-escaped, so `html.Render("<p>{name}</p>")` is already XSS-safe; `html.Raw(...)`/`html.Embed(...)` are the explicit opt-outs for pre-asserted-safe content |
| `fetch.Get(url)` in handler | `fetch.SafeGet(url)` (or `fetch.NewExternal(url) \|> ... \|> Do()` for builder) |
| `files.Read(path)` in handler | `url.CleanPath(path)` first, then `sandbox.New(trustedRoot)` + `box.Read(cleaned)`; `sandbox.New` itself is flagged only when the root path is request-derived (`r.PathValue(...)`, `r.Host`, etc.) — use a trusted, non-request-derived path for the root |
| `shell.Run("cmd {var}")` | `shell.Output("cmd", arg)` |
| `httphelper.Redirect(w, nonLiteral)` / `res.Redirect(nonLiteral)` | `httphelper.SafeRedirect(w, url, "host")` / `res.SafeRedirect(url, "host")` |
| `html.Render("<script>...")` | Static `.js` file with `<script src="...">` |
| `regex.MustCompile(userPattern)` (non-literal pattern) | `regex.MatchSafe(text, pattern)` returns error, or hoist with `regex.MustCompile` at init + `p.Match(text)` |
| `notify("https://{r.Host}/...")` / `f(r.Host)` (Host-header forgery) | Wrap handler with `httphelper.TrustedHosts(handler, allowed...)`, or compare `r.Host` to an allowlist before reading it |

`http.SafeRedirect` rejects non-`http`/`https` schemes (`javascript:`, `data:`, `file:`), protocol-relative `//host`, and bare relative paths — only allow-listed hosts on absolute http(s) URLs. `http.TrustedHosts(handler, allowed...)` installs once at the edge and makes `r.Host` trustworthy downstream. `http.RealIP(r, trustedProxies...)` parses `X-Forwarded-For` / `X-Real-Ip` only when `r.RemoteAddr` matches a trusted CIDR. `url.CleanPath` / `url.IsSubpath` normalize user-supplied paths (reject `..`, `%2e%2e`, `%2f`, backslashes, NUL) before they hit a route table or filesystem.

---

### Skills (Agent Tool Packaging)

```kukicha
# target: mcp
petiole weather

skill WeatherService
    description: "Provides weather forecasts."
    version: "1.0.0"

# ... MCP server implementation
```

`kukicha pack weather.kuki` produces an [agentskills.io](https://agentskills.io/specification)-compliant directory: `skills/weather-service/SKILL.md` (frontmatter + body) plus a source copy under `scripts/` — no binary compilation. Agents invoke the skill by running the source at call time: `kukicha run scripts/weather-service.kuki <args>`. Pass a directory to pack multi-file skills.

---

### Testing

Test files use `*_test.kuki` with the table-driven pattern:

```kukicha
petiole slice_test

import "stdlib/slice"
import "stdlib/test"
import "testing"

type TakeCase
    name: string
    n: int
    wantLen: int

func TestTake(t: reference testing.T)
    items := list of string{"a", "b", "c", "d", "e"}
    cases := list of TakeCase{
        TakeCase{name: "3 elements", n: 3, wantLen: 3},
        TakeCase{name: "n > length", n: 10, wantLen: 5},
    }
    for tc in cases
        t.Run(tc.name, (t: reference testing.T) =>
            result := slice.Take(items, tc.n)
            test.AssertEqual(t, len(result), tc.wantLen)
        )
```

Assertions: `AssertEqual`, `AssertNotEqual`, `AssertTrue`, `AssertFalse`, `AssertNoError`, `AssertError`, `AssertContains` (substring for strings, element for slices, key for maps), `AssertErrorIs` (sentinel identity + `%w` chains), `AssertPanics`, `AssertNotEmpty`, `AssertNil`, `AssertNotNil`.

**Running tests.** There is no `kukicha test` subcommand — `go test` is the runner, operating on transpiled `.go` files next to the sources (gitignored artifacts, not committed). Directory builds *exclude* `*_test.kuki`, so transpile test files individually with `--skip-build`:

```bash
kukicha build ./internal/foo/                                  # package code → foo/main.go
kukicha build --skip-build --package-context foo/foo_test.kuki # test file → foo/foo_test.go
go test ./internal/foo/...                                     # or go test ./... at the repo root
```

`--package-context` lets the single test file resolve types from its sibling `.kuki` files. In CI, run the same two steps before `go test ./...`.

---

### Pitfalls

**`in` / `not in` are membership operators**: `x in xs` works on lists (element comparison), maps (key lookup), and strings (substring). For lists with non-comparable element types (slices, maps, funcs as elements), use `slice.Contains` with a custom predicate. `in` also still drives `for` loops.

**`ctxpkg.WithTimeout` (and `WithCancel`/`WithDeadline`) returns `Handle` by value**, not `reference Handle`. `defer h.Cancel()` belongs in the function that *uses* the resource, not in a builder that returns it — a defer in the builder cancels the context before the caller can use it.

**Discards.** Kukicha forbids `_ = call()` for sole-value discards — call the function as a bare statement and let `onerr` handle the error. Multi-return destructuring (`_, err := f()`) is allowed, and any name starting with `_` (`_v`, `_reason`) is a write-only discard: assign to it freely, but reading it back (`x := _v + 1`) is a compile error. If two or more callers spell the same return slot as `_`, the signature is wrong — drop the return rather than spreading discards across call sites.

---

### Troubleshooting

| Error | Fix |
|-------|-----|
| `use {error} not {err} inside onerr` | Change `{err}` to `{error}`, or use `onerr as e` |
| `variable 'x' not used` | Remove the variable, or use it; never use `_ = x` to suppress — remove the dead code instead |
| `function must declare return type` | Add explicit return type: `func F() int` |
| `lambda parameter 'n' has no type annotation and no type could be inferred from context` | Annotate the param: `(n: int) => ...` or pass the lambda where its signature is known (pipe to `slice.Filter`, etc.) |
| `SSRF risk` / `path traversal` / `command injection` / `XSS risk` | See Security table above |
| `expected INDENT` | Check 4-space indentation (no tabs) |
| `expected 'when' or 'default'` | Use `when`/`default` |

<!-- kukicha:end -->
