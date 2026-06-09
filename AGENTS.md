# Town Builder – Copilot Instructions

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
`internal/config/config.kuki` exposes settings loaded from `.env`. Key variables:
- `DISABLE_JWT_AUTH=true` – bypass auth in development/tests.
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

Detailed Kukicha reference (syntax, stdlib, compiler-enforced security checks, gotchas) lives in the `kukicha` skill at `.claude/skills/kukicha/SKILL.md`. It is auto-loaded when you edit `.kuki` files or use kukicha tooling.

`kukicha init` recreates this section if regenerated — leave the skill as the source of truth and replace the regenerated block with this pointer if it returns.


<!-- kukicha:start -->
## Writing Kukicha

Kukicha is a near-superset of Go: most Go compiles as-is, with a few exceptions (`range`, `case`/`default`, `struct {}`, `chan T`, `goto`, parenthesized `const ( ... )`) that have Kukicha replacements. **Always
write Kukicha syntax** (`and`/`or`/`not`, `list of T`, `onerr`, pipes, enums)
and use Kukicha's stdlib (`stdlib/*`) over raw Go packages. Fall back to Go
only when Kukicha has no equivalent.

When `kukicha init` is run, this file is created and the stdlib is extracted
into `.kukicha/stdlib/`. Browse the source files there for full API details
beyond what this reference covers.

**Orienting on an unfamiliar project:** run `kukicha context <dir>` first — it returns the petiole, files, entry point, imports, top-level functions/types/enums, and the right `check`/`build`/`run` commands as JSON. Cheaper than grepping the tree.

### Getting Started

```kukicha
# hello.kuki — minimal program
import "stdlib/string"

func main()
    name := "world"
    print("Hello {string.ToUpper(name)}!")
```

Run: `kukicha run hello.kuki` · Build: `kukicha build hello.kuki`

**Multi-file packages:** `kukicha build myapp/` merges all `.kuki` files. One file defines `func main()`, others use `func init()`. All files need the same `petiole` declaration (Go's `package`).

### Syntax Reference

| Kukicha (write this) | Go equivalent (avoid in `.kuki` files) |
|----------------------|----------------------------------------|
| `and`, `or`, `not` | `&&`, `\|\|`, `!` |
| `equals`, `isnt` | `==`, `!=` |
| `empty` | `nil` |
| `list of string` | `[]string` |
| `map of string to int` | `map[string]int` |
| `reference User` / `reference of x` | `*User` / `&x` (statically guaranteed non-empty) |
| `optional reference User` | `*User` (may hold `empty`; must be narrowed with `isnt empty` before `dereference`) |
| `dereference ptr` | `*ptr` |
| `name: Type` (params, receivers, lambdas) | `name Type` (bare; parses but warns as deprecated) |
| `func Method on t: T` | `func (t T) Method()` (accepted as Go-compat input but not idiomatic) |
| `many args: T` | `args ...T` |
| `make channel of T` | `make(chan T)` |
| `send val to ch` / `receive from ch` | `ch <- val` / `<-ch` |
| `when` / `default` | `case` / `default` |
| `for item in items` | `for _, item := range items` |
| `for i from 0 to 10` | `for i := 0; i < 10; i++` |
| `for i from 0 through 10` | `for i := 0; i <= 10; i++` |
| 4-space indentation | `{ }` braces |

`func`/`var`/`const`/`enum` have aliases `function`/`variable`/`constant`/`enumeration`: use the short forms in production code; reserve the long forms for beginner/intermediate tutorials only.

**`equals` and `isnt` replace every `==` and `!=` — not just nil/empty checks.**

```kukicha
if count equals 0           # not: count == 0
if phase isnt enums.SETUP   # not: phase != enums.SETUP
if name equals "admin"      # not: name == "admin"
if pos equals dest          # not: pos == dest
```

### Constants

Constants are fixed values determined at compile time. Declare them one at a time with `const`, either at the top level or inside a function body for tunable parameters that should be visually flagged as immutable:

```kukicha
const PI = 3.14159
const MaxRetries int = 5

func updateCarPhysics(this: js.Value, args: list of js.Value) any
    const ACCELERATION = 5.0
    const MAX_SPEED    = 20.0
    ...
```

For a group of related constants — especially sequential integers or string-backed labels — use `enum` instead. Enums replace Go's `const ( ... iota ... )` block and give you typed values, an autogenerated `String()` method, and (for string-backed enums) a `ParseX` helper:

```kukicha
enum Status
    Active   # 0
    Inactive # 1
    Archived # 2

enum Format: string
    JSON = "json"
    XML  = "xml"
```

The parenthesized `const ( ... )` form and `iota` are Go-only — write `enum` in `.kuki` files. See [Enums](#enums) for the full reference.


### Variables and Functions

```kukicha
count := 42           # inferred type
count = 100           # reassignment

var p optional reference int   # zero-value declaration (bare `reference T` rejects this — see Nullable references)
var xs list of string

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

# Optional `:` between param name and type — beginner-friendly synonym
func triage(issue: Issue) Verdict
    return Verdict{}
```

### Strings and Interpolation

```kukicha
greeting := "Hello {name}!"          # {expr} is interpolated — replaces fmt.Sprintf
json := "key: \{value\}"             # \{ \} for literal braces
path := "{dir}\sep{file}"            # \sep → OS path separator at runtime

# Raw strings (backticks) — no escapes, no interpolation
prompt := `Reply JSON: {severity:1-5, kind, summary}`

# Multi-line strings — auto-dedented to the indent of the closing delimiter.
# Two flavors, both support {expr} interpolation and \{ \} escapes:

# """...""" — triple-quoted. Use for prompts, markdown, long error messages.
prompt := """
    {preamble}
    Classify GitHub issues. Reply JSON: \{severity:1-5, kind\}
    """

# '...' — single-quoted. Use when the content contains "..." (HTML, JSON-with-quotes).
html := '
    <article class="card" data-title="{title}">
        <h3>{title}</h3>
    </article>
    '

# Escape sequences: \n \t \r \\ \" \' \xHH \0-\377
# Number literals: 42, 0xFF, 0o755, 0b1010, 3.14
```

**Picking a string form:**
- `"..."` — one-liners. Interpolation on.
- `` `...` `` — content with `{` `}` literals (regex, JSON templates). No interpolation, no escapes.
- `"""..."""` — multi-line prose (prompts, markdown). Interpolation on; escape literal braces with `\{` `\}`.
- `'...'` — multi-line content with embedded double quotes (HTML, SQL). Interpolation on.

### Types

```kukicha
type Repo
    name  string as "name"            # JSON field alias
    stars int    as "stargazers_count"
    tags  list of string

# Defined named type (distinct from base — needs explicit conversion: UserID(42))
type UserID int
type Status string

# Function type alias
type Handler func(context.Context, string) (string, error)

# Transparent type alias (type X = Y — identical types, cross-package assertions work)
type TextContent = mcp.TextContent

# Use transparent aliases to tame long multi-token types in signatures.
# Rule of thumb: alias if the type repeats 3+ times in a file or pushes
# a signature past ~100 columns.
type UserMap = map of string to reference User

func MergeUsers(primary: UserMap, secondary: UserMap, overrides: list of UserMap) UserMap
```

### Nullable references

`reference T` is **statically non-empty** — the compiler guarantees it. Use it for builder receivers, constructor returns, and anywhere a value is always present.

`optional reference T` is the opt-in form for references that *may* hold `empty`. Use it for optional struct fields, lookup results that can miss, and zero-value var declarations.

Rules:

- `dereference x` on a `optional reference T` is an error unless x is narrowed in the current branch (`if x isnt empty`, `if x equals empty: return`, or the Go-style `!= nil` / `== nil` forms).
- `var p reference T` without an initializer is rejected — either initialize it or declare it `optional reference T`.
- Struct fields can't be bare `reference T` (the zero value would be `empty`); declare them `optional reference T`.
- **Calling a `reference func(...)` field needs no `dereference`** — after narrowing, just call it: `wh.on_connect(args)`. The compiler inserts the pointer deref for you. Writing `dereference wh.on_connect(args)` is a trap: `dereference` binds to the whole call, so it reads as "deref the receiver `wh`," not "deref the function pointer." It still compiles to the right thing now, but the bare call is what you mean.

```kukicha
func Greet(u: reference User) string         # u is guaranteed non-empty
    return "hello " + u.Name                 # no guard needed

func LookupOr(id: int) optional reference User
    return users.Get(id) onerr empty         # may miss

caller := LookupOr(42)
if caller isnt empty
    print(dereference caller)                # narrowed → ok
```

Mass-migrate existing code with `kukicha infer-nullable --apply <dir>` — it rewrites bindings that are observed assigned/compared to `empty`. Conservative and idempotent.

**Constructors that build pointer-bearing state must return `reference T`, not `T`.** A value-returning constructor that stores a closure (or a `reference of local.field`) capturing the local it builds, then returns that local by value, hands the caller a *copy* at a different address — but the copy's closure still points at the discarded original. Mutations through it never reach the value the caller holds:

```kukicha
func NewOuter() Outer                 # value return — trap
    o := Outer{}
    o.handler = () => o.inner.SetVal()  # captures &local_o.inner
    return o                            # COPY: handler points at the discarded o

func NewOuter() reference Outer        # fix — stable shared address
    o := Outer{}
    o.handler = () => o.inner.SetVal()
    return reference of o
```

The compiler flags the value-return form (`semantic/value-ctor-capture`; `kukicha explain semantic/value-ctor-capture`). Silence with `KUKICHA_LINT_VALUE_CTOR_CAPTURE=0` if you genuinely want the copy semantics.

When you're choosing a return signature: use `optional reference T` whenever absence is the only failure mode (lookups, optional config). Reserve `(reference T, error)` for genuine errors (I/O, parse, network) where the error message is part of the value. Wrapping a "not found" lookup in `(reference T, error)` reads as "something went wrong" when nothing did — `optional reference T` is what the code means.

### Enums

```kukicha
enum Status
    OK = 200
    NotFound = 404
    Error = 500

status := Status.OK    # dot access → transpiles to StatusOK

# Exhaustiveness-checked switch
switch status
    when Status.OK
        print("ok")
    when Status.NotFound, Status.Error
        print("problem")
```

- Underlying type (int or string) inferred from values; all must match
- Compiler warns on missing cases unless `default` present
- Integer enums warn if no case has value 0
- Auto-generated `String()` method

### String-Backed Enums (`enum Name: string`)

For closed sets of string values. Compiler generates `String()` (raw value) and a package-level `Parse<Name>` returning `(<Name>, bool)`. Parse at the boundary so typos fail fast.

```kukicha
enum Bump: string
    Patch = "patch"
    Minor = "minor"
    Major = "major"

b, ok := ParseBump(raw)
if not ok
    cli.Fatal("invalid --bump value '{raw}'")
```

### Variant Enums (Tagged Unions)

Reach for variant enums when another language would force a sentinel value, `None`-overloading, or a `(T, ok)` boolean pair — the type system distinguishes the cases by name, and `switch` arms get exhaustiveness checking.

The strongest fit is the **decode-at-boundary** pattern: a wire format or SSE stream is parsed once at the edge into a variant (e.g. `OpencodeEvent { MessageUpdated, PartUpdated, PartDelta, Reconnect }`), and downstream consumers `switch ... as v / when …` exhaustively — no string-typed `evt.Type` checks scattered across handlers. See `kukicha-shaped-problems.md` for the full pattern, including when *not* to reach for variants (flat SQLite rows, pure tag enums).

```kukicha
enum Shape
    Circle
        radius float64
    Rectangle
        width  float64
        height float64
    Point

# Pattern matching
func area(s: Shape) float64
    switch s as v
        when Circle
            return 3.14159 * v.radius * v.radius
        when Rectangle
            return v.width * v.height
        when Point
            return 0.0

# Multiple variants can share a body
func isZero(s: Shape) bool
    switch s as v
        when Point
            return true
        when Circle, Rectangle
            return false

# Single-case check with binding
if s is Circle as c
    return 3.14159 * c.radius * c.radius
```

- Cannot mix value cases (`= literal`) and variant cases in the same enum
- `is` for bool checks; `is CaseName as v` binds in `if` blocks (top-level condition only)
- **3+ arms → use `switch x as v` + `when` arms** (gets exhaustiveness checking). Reserve `if v is X as y` for single-case binding or single-arm filters inside a `for` loop. Sequential `if v is A` / `if v is B` / `if v is C` chains are a code-smell — convert to `switch`.

A variant enum may declare one or more type parameters with `enum Name of T and E` (use `and`, never commas — `enum X of T, E` is a compile error):

```kukicha
enum Result of T and E
    Ok
        Value T
    Err
        Err E

func divide(a: int, b: int) Result of int and string
    if b equals 0
        return Err{Err: "division by zero"}
    return Ok{Value: a / b}
```

- Construction (`Ok{Value: 5}`) infers type args from the surrounding
  return / var-decl / call-argument type. There is no syntax to write
  them explicitly at the call site.
- Bindings substitute through automatically: in `if r is Ok as o` (or
  `switch r as v ... when Ok`), `o.Value` has the concrete type used to
  instantiate `r`.
- **Cross-package variants** work the same way with qualified names —
  `import "stdlib/result"` lets you write `result.Result of int and string`,
  `result.Ok{Value: 5}`, and `r is result.Ok as o`. The canonical
  fixture is `stdlib/result`.

### Methods

```kukicha
func Display on todo: Todo string
    return "{todo.id}: {todo.title}"

func SetDone on todo: reference Todo       # pointer receiver
    todo.done = true
```

### Error Handling (`onerr`)

`onerr` is for **fallible operations** — calls that can genuinely fail (I/O, parsing, network, validation). Reach for it when the failure case is a real error you want to recover from, propagate, or log.

For **expected absence** with a sensible default — env vars, slice index, map key, find-by-predicate — prefer the package's `*Or` variant (`env.GetOr`, `slice.GetOr`, `slice.FirstOr`, `slice.FindOr`, `maps.GetOr`). `pkg.XOr(args, default)` reads as "give me X, or this default"; `pkg.X(args) onerr default` reads as "do X; on error, fall back" — when there is no real error, the first form is what the code means.

```kukicha
# Expected absence → *Or
region := env.GetOr("AWS_REGION", "us-east-1")
first  := slice.FirstOr(items, defaultItem)
user   := slice.FindOr(users, u => u.Active, guestUser)

# Real failure → onerr
data    := fetch.Get(url) onerr panic "failed: {error}"
apiKey  := env.Get("GITHUB_TOKEN") onerr return        # required secret, absence is an error
n       := parse.Int(raw) onerr 0                       # parse can actually fail
```

The caught error is always `{error}` — **never** `{err}`. Use `onerr as e` to rename.

```kukicha
data := fetch.Get(url) onerr panic "failed: {error}"        # stop with message
data := fetch.Get(url) onerr return                         # propagate (raw, zero values) — or bare early-exit in a void func
data := fetch.Get(url) onerr return empty, error "{error}"  # propagate (wrap)
port := getPort()      onerr 8080                           # default value
riskyOp()              onerr discard                        # ignore (warns; test code only)
v    := parse(item)    onerr continue                       # skip in loop

# Block form (optionally `onerr as e`)
users := parse() onerr
    print("failed: {error}")
    return

# `fallback EXPR[, EXPR...]` terminates an onerr block with a default value.
# Use when you need side effects (logging) AND a default. Expression count must
# match LHS slot count.
setting := loadConfig(path) onerr
    print("loadConfig failed: {error} — using default")
    fallback "default-config"
```

### Pipes

```kukicha
result := data |> parse() |> transform()

# _ placeholder for non-first argument
todo |> json.Write(w, _)   # → json.Write(w, todo)

# `_` is reserved for this purpose and as the blank assignment target.
# Reading it as a value (`fmt.Println(_)`, `x := _ + 1`) is a compile error.

# Bare identifier as target
data |> print                     # → fmt.Println(data)

# Pipeline-level onerr — catches errors from any step
resp := fetch.Get(url) |> fetch.CheckStatus() onerr panic "{error}"
items := fetch.JSON of list of Repo from resp onerr panic "{error}"

# Piped switch
user.Role |> switch
    when "admin"
        grantAccess()
    default
        checkPermissions()

# Piped switch on a variant enum — exhaustiveness-checked
shape |> switch as v
    when Circle
        return v.radius * v.radius
    when Square
        return v.side * v.side

# Piped switch with multi-return arms — IIFE emits a tuple signature.
# Legal when every arm returns the matching arity. A `return X` inside a
# statement-position piped switch (its IIFE value is discarded) is
# diagnosed — use the statement-form `switch x` / `switch x as v` instead.
func parseKind(s: string) (string, error)
    return s |> switch
        when "tick"
            return "T", empty
        default
            return "", error "unknown"

# Tee a pipe value — `|> also as name` binds the upstream value into the
# enclosing scope and passes it through unchanged. Valid only when the
# pipe is the RHS of `:=` / `=` or a bare expression statement.
n := 5
    |> double()
    |> also as ten
    |> double()
# ten == 10, n == 20

# Shorthand .Field / .Method() — pipe context only
name := user |> .Name
```

### Control Flow

```kukicha
if count equals 0
    return "empty"
else if count < 10
    return "small"

for item in items
    process(item)

# Map iteration — `for x in m` yields *values*, not keys (Go-like).
# To get keys, use the two-variable form and discard the value with `_`.
for k, v in scores         # k = key, v = value
    print("{k}: {v}")
for k, _ in scores         # keys only
    print(k)
for v in scores            # values only (same as `for _, v in scores`)
    print(v)

for i from 0 to 10        # 0..9 (exclusive)
for i from 0 through 10   # 0..10 (inclusive)
for i from 10 through 0   # descending

for                        # infinite loop (use break to exit)
    msg := receive from ch
    if msg equals "quit"
        break

# If-expression (ternary)
result := if condition then "yes" else "no"

# If with init statement
if val, ok := cache[key]; ok
    return val

switch command
    when "fetch", "pull"
        fetchRepos()
    default
        print("Unknown: {command}")

# Bare switch (condition-based)
switch
    when stars >= 1000
        print("popular")
    default
        print("new")

# Type switch
switch event as e
    when string
        print(e)
    when reference TaskEvent
        print(e.Status)

# `where` guard on a `when` clause — predicate on the matched value.
# A guarded case does NOT cover its variant for exhaustiveness; add an
# unguarded `when X` fallback (or `default`).
switch shape as s
    when Circle where s.radius > 10.0
        return "big circle"
    when Circle
        return "small circle"
    when Square
        return "square"
```

### Lambdas

Parameter types are inferred from context; explicit annotations are optional.

```kukicha
repos   |> slice.Filter(r => r.stars > 100)     # inferred type
entries |> sort.ByKey(e => e.name)
repos   |> sort.By((a, b) => a.stars < b.stars)  # two params

# Block lambda (multi-statement)
repos |> slice.Filter(r =>
    name := r.name |> strpkg.ToLower()
    return name |> strpkg.Contains("go")
)

# Block lambdas may contain pipe chains and onerr:
db.Transaction(pool, (tx) =>
    db.TxExec(tx, "UPDATE accounts SET balance = balance - $1 WHERE id = $2", amt, from) onerr return
    db.TxExec(tx, "UPDATE accounts SET balance = balance + $1 WHERE id = $2", amt, to)   onerr return
    return empty
) onerr panic "transfer failed: {error}"

# Cross-package named types infer from the callback signature — no helper func needed:
retry.DoCtx(ctx, cfg, (h) =>            # h is ctxpkg.Handle, inferred
    _, err := fetch.GetCtx(h, url)
    return err
)
```

### Collections and Literals

```kukicha
items  := list of string{"a", "b", "c"}
config := map of string to int{"port": 8080}
last   := items[-1]    # negative indexing
delete config["port"]  # remove a key from a map

# Untyped literals — type inferred from context
func makeConfig() Config
    return {host: "localhost", port: 8080}    # inferred from return type

applyConfig({host: "prod", port: 443})        # inferred from parameter
```

Inference works in return statements, `onerr return`, function arguments, assignments, and typed list elements.

### Variadic Arguments (`many`)

```kukicha
func Sum(many numbers: int) int
    total := 0
    for n in numbers
        total = total + n
    return total

nums := list of int{1, 2, 3}
result := Sum(many nums)    # spread a slice
```

### Type Casts and Assertions

```kukicha
n := x as int                         # type conversion
result, ok := value.(string)          # safe type assertion
s := value.(string)                   # panics if wrong type
```

### Concurrency

```kukicha
ch := make channel of string
send "message" to ch
msg := receive from ch
go doWork()

# Multi-statement goroutine
go
    defer wg.Done()
    doWork()

# Select
select
    when receive from done
        return
    when msg := receive from ch
        print(msg)
    when send "ping" to out
        print("sent")
    default
        print("nothing ready")

# Arm bodies may be empty — omit the indented block:
select
    when send true to ch
    default
```

### Defer

```kukicha
defer resource.Close()

# Block form (emits defer func() { ... }())
defer
    if r := recover(); r isnt empty
        tx.Rollback()
        panic(r)
```

### Imports and Aliases

```kukicha
import "stdlib/slice"
import "stdlib/ctx"       as ctxpkg     # clashes with local 'ctx'
import "stdlib/db"        as dbpkg      # clashes with local 'db'
import "stdlib/errors"    as errs       # clashes with 'errors'
import "stdlib/json"      as jsonpkg    # clashes with 'encoding/json'
import "stdlib/string"    as strpkg     # clashes with 'string' type
import "stdlib/http"      as httphelper # clashes with 'net/http'

import "github.com/jackc/pgx/v5" as pgx  # external package
```

Always use these aliases when the package name clashes — collisions cause compile errors.

### Commands

```bash
kukicha init [module]     # scaffold project + extract stdlib to .kukicha/ (re-run to update after compiler upgrade)
kukicha check <target>    # validate syntax (no codegen)
kukicha build <target>    # transpile + compile to binary
kukicha run <target>      # transpile + compile + run
kukicha fmt -w <target>   # format in place (use --check in CI)
kukicha context <target>  # project metadata as JSON (for agents)
kukicha context --graph <target>  # add the knowledge graph: nodes + call/import edges
kukicha context --stdlib  # stdlib API index as JSON: signatures + docs + security/deprecated/panics tags
kukicha brew <target>     # convert .kuki → standalone .go (publication only)
kukicha explain <code>    # title + summary + reproducer + fix recipe for a diagnostic code or concept/* construct (--list to enumerate)
```

Run `kukicha <cmd> --help` for flags. Common ones: `--json` (structured diagnostics on `check`/`build`/`run`/`fmt`), `--wasm` (build), `--vulncheck` (build), `--strict-onerr` (check), `--package-context` (single-file `check`/`build` that resolves refs into sibling `.kuki` files). Also: `kukicha audit`, `kukicha pack`, `kukicha skills {add,list,remove,verify,update}`. When the compiler emits a diagnostic with a stable code (e.g. `[semantic/deref-nullable]`), `kukicha explain <code>` prints the full recipe. The same command also teaches language constructs via the `concept/*` namespace (`kukicha explain concept/pipes`, `concept/onerr`, `concept/variant-enums`, `concept/fallback`, …); `--list` groups both diagnostics and concepts. Editors backed by `kukicha-lsp` surface these explanations on hover — both the diagnostic recipe under the cursor and a `concept/*` lesson when hovering a Kukicha-only keyword or `|>`/`=>`. Run `kukicha fmt -w` before committing.

**Compiler directives** — `# kuki:...` comments attached above a declaration or statement:

```kukicha
# kuki:deprecated "msg"   # func/type/interface/enum: warn at every call/use site
# kuki:panics "msg"       # func: warn at call sites that the callee may panic
# kuki:security "cat"     # func: security sink; cat = sql|html|fetch|files|redirect|shell|regex
# kuki:validate "rules"   # struct field: generate Validate() (see the validate package)
# kuki:returns N          # statement: declare return-arity of an unresolvable external Go call
# kuki:typearg            # stdlib func: accepts `f of T from x` typed-decode syntax
# kuki:embed PATTERN      # var: emit //go:embed PATTERN above `var name embed.FS` / `string` / `[]byte`
```

`# kuki:returns N` is the escape hatch when `onerr` rejects a third-party Go call with *"return signature is unknown"* — `N` counts all Go returns including the trailing `error`. The Go stdlib is resolved live, so this is almost always for vendored modules.

**Environment variables:** `KUKICHA_CACHE=1`, `KUKICHA_PROFILE=1`, `KUKICHA_JOBS=N`, `KUKICHA_LINT_SHADOW=0`, `KUKICHA_LINT_UNUSED_LOOP_VAR=0`, `KUKICHA_DISABLE_LIVE_GO_STDLIB=1`. See `docs/` or source for the full set.

`kukicha skills` is Kukicha's native replacement for `npx skills add`. It fetches a GitHub tarball, extracts via `stdlib/archive` (zip-slip safe, size-capped), and installs SKILL.md folders into `.claude/skills/` and/or `.agent/skills/` — whichever exist in the current dir (or both with `--global` writing to `~/.claude/skills/` and `~/.agent/skills/`). Multi-skill repos require `--skill <name>` or `--all`. Flags can appear in any position relative to the slug. Honors `GITHUB_TOKEN` for private repos and rate limits.

### Project layout & build flow

**`.kuki` is the source. Commit `.kuki`, not brewed `.go`.** A Kukicha repo's
edit loop is:

```bash
kukicha check internal/foo/      # fastest: syntax + semantic, no codegen
kukicha build ./cmd/server       # transpile + go build the whole tree
kukicha run ./cmd/server         # transpile + go build + run
```

Contributors install Kukicha the same way they install Go — it's a one-line
`go install`. Do **not** commit brewed `.go` next to every `.kuki` "so people
without Kukicha can build" — that creates two sources of truth, doubles diff
noise, and invites hand-edits to the generated Go. If a `.kuki` file lives in
the repo, the matching `.go` should be in `.gitignore` (or under a `gen/`
output dir), not committed.

**Multi-file directories.** `kukicha build myapp/` merges every `*.kuki` in a
directory into a single `main.go` and compiles it. Rules:

- Exactly one file in the directory defines `func main()`.
- Other files use `func init()` for startup.
- All files share the same `petiole` declaration (or all omit it).
- `*_test.kuki` files are excluded from the merge and brewed as siblings
  (see below).
- One petiole per directory — don't mix package names within a folder.

### Brewing (`kukicha brew`) — for publication, not for builds

`kukicha brew` converts `.kuki` to standalone `.go` that builds with the Go
toolchain alone. Use it when you need a Go-only artifact: shipping a library
to consumers who don't use Kukicha, vendoring into a non-Kukicha repo, a
one-time port, or producing source for a build tag the regular pipeline
doesn't handle. **It is not part of the normal build/test edit loop** —
`kukicha build` and `kukicha run` invoke the transpiler internally.

```bash
kukicha brew file.kuki                          # → file.go next to source
kukicha brew --stdout file.kuki > out/file.go   # write somewhere else
kukicha brew --remove-kuki dir/                 # brew dir, delete .kuki originals
kukicha brew dir/                               # main.go + every *_test.kuki → *_test.go
```

The directory form (`kukicha brew dir/`) is the recommended way to brew a
package: it produces a `main.go` from the merged sources plus an individual
`*_test.go` per `*_test.kuki`, which is exactly the layout `go test` expects.

**Build tags.** Brewed files get `//go:build ignore` by default so they
don't accidentally get picked up by `go build ./...` alongside their source.
Override with `--build-tag`:

```bash
kukicha brew --build-tag "js && wasm" physics.kuki > physics_wasm.go
kukicha brew --build-tag "linux && amd64" syscall_linux.kuki
```

Don't `sed` the build directive after the fact — `--build-tag` is what that
flag is for.

`kukicha context <file|dir>` emits a JSON snapshot for agents and CI. Top-level functions, types, and enums carry their signature, fields, and cases so callers can write code against the package without re-reading the source. Methods and interface methods are still excluded to keep the shape flat. Test files (`*_test.kuki`) appear under separate `test_files` / `test_functions` fields:

```json
{
  "kukicha_version": "0.19.5",
  "petiole": "myapp",
  "is_directory": true,
  "files": ["main.kuki", "lib.kuki"],
  "test_files": ["lib_test.kuki"],
  "entry_point": "main.kuki",
  "imports": [{"path": "stdlib/slice", "alias": ""}],
  "functions": [
    {"name": "Hello", "signature": "Hello(name: string) string", "exported": true},
    {"name": "main", "signature": "main()", "exported": false}
  ],
  "types": [
    {"name": "User", "exported": true, "fields": [{"name": "Name", "type": "string"}]}
  ],
  "enums": [
    {"name": "Status", "exported": true, "cases": ["Active", "Inactive"]}
  ],
  "test_functions": [
    {"name": "TestHello", "signature": "TestHello()", "exported": true}
  ],
  "effects": {"sync": ["fetch", "sql"]},
  "commands": {"check": "...", "build": "...", "run": "..."}
}
```

`entry_point` is omitted for library projects or when multiple `func main()` declarations are found across files. `effects` lists per-function transitive security categories (sql, html, fetch, files, redirect, shell, regex) and is omitted when no function reaches into `# kuki:security`-tagged stdlib. Names are deduplicated across files and sorted.

Pass `--graph` to add two fields — `nodes` and `edges` — that form the project knowledge graph. Nodes cover the package, its functions/methods (`kind` `func`/`method`, with `file` and folded-in `effects`), and imported packages (`kind` `import`). Edges are `call` (caller→callee, type-resolved from the same call graph that drives effect inference) and `import` (package→imported path). Both endpoints of every edge are emitted as nodes. The default output is unchanged when `--graph` is absent.

```json
{
  "nodes": [
    {"id": "myapp", "kind": "package"},
    {"id": "sync", "kind": "func", "file": "main.kuki", "effects": ["fetch", "sql"]},
    {"id": "stdlib/db", "kind": "import"}
  ],
  "edges": [
    {"from": "myapp", "to": "stdlib/db", "kind": "import"},
    {"from": "main", "to": "sync", "kind": "call"}
  ]
}
```

---

### Stdlib Packages

The stdlib is extracted to `.kukicha/stdlib/` on `kukicha init` — **read the `.kuki` source for full signatures**. This section gives import paths + one-liners so you know what exists; a few examples below show non-obvious idioms.

**Collections & strings.** `stdlib/slice` (`Filter`/`Map`/`Reject`/`Partition`/`Sort`/`First`/`FindOr`/`Sum`/`Min`/`Max`…), `stdlib/maps`, `stdlib/set`, `stdlib/sort` (`By`/`ByKey`), `stdlib/string` as `strpkg`, `stdlib/regex` (`MustCompile` + `*Compiled` variants), `stdlib/iterator` (lazy `iter.Seq`), `stdlib/cast` (`SmartInt`/`SmartBool`/`IsNil`…), `stdlib/math` (`Abs`/`Round`/`Clamp` — reach for Go's `math` for `Sqrt`/`Pow`/…).

**Data & encoding.** `stdlib/json` as `jsonpkg`, `stdlib/parse` (typed `parse.JSON of T from text`, also YAML/Form/Env/CSV/Int/URL — auto-runs `Validate()`), `stdlib/encoding` (base64/hex), `stdlib/template`, `stdlib/markdown` (CommonMark+GFM, pair with `http.SafeHTML` for untrusted input).

**I/O & files.** `stdlib/files` (`Read`/`Write`/`Copy`/`List`/`Watch`/…), `stdlib/archive` (zip+tar.gz, zip-slip + decompression-bomb safe), `stdlib/sandbox` (filesystem jail for HTTP handlers), `stdlib/shell` (`Output`/`Lines`/`Capture` + `shell.New |> .Dir |> .Env |> .Stdin |> .Output()` builder).

**HTTP & networking.** `stdlib/fetch` (client with builder, auth, retry, SSRF — `Get`/`SafeGet`/`GetJSON of T from url`), `stdlib/http` as `httphelper` (`JSON*` responders, `SafeRedirect`, `SafeHTML`, `TrustedHosts` middleware, `RealIP` for client-IP behind a proxy), `stdlib/html` (auto-escaping components), `stdlib/netguard` (SSRF guards), `stdlib/url` (parse/build/encode, `CleanPath`/`IsSubpath` for traversal-safe paths), `stdlib/shellguard` (subprocess allowlist for agent ops, fail-closed), `stdlib/policy` (approval-gate variant for agent ops, fail-closed).

**CLI & system.** `stdlib/cli` (flag/subcommand parser — prefer typed `BoolFlag`/`IntFlag`/`StringFlag` over generic `AddFlag`), `stdlib/input` (`Prompt`/`Confirm`/`Choose`, `NewForm`), `stdlib/table`, `stdlib/color`, `stdlib/term` (**single source of truth for tty/color/width — `IsTTY`/`VisibleWidth`/`PadRightVisible`**), `stdlib/log` (leveled structured logger), `stdlib/env` (`Get`/`GetOr`/`GetInt`/`GetBool`), `stdlib/must` (panic-on-error startup), `stdlib/signal` (`WaitFor`/`Context` with English signal names).

**Concurrency & resilience.** `stdlib/concurrent` (`Parallel`/`Map`/`Go`), `stdlib/bus` (in-process pub/sub with per-subscriber Observer flag: load-bearing subs propagate backpressure errors, observers silently drop and track a `Dropped` counter), `stdlib/ctx` as `ctxpkg`, `stdlib/retry` (backoff + circuit breaker via `NewBudget`/`BudgetExceeded`), `stdlib/datetime`.

**Data & storage.** `stdlib/db` as `dbpkg` (SQL with struct scanning: `Query |> ScanAll of T`), `stdlib/sqlite` (WAL/foreign-keys defaults; queries go through `stdlib/db`), `stdlib/sqliteext` (register ncruces extensions — process-global, one-shot at startup), `stdlib/audit` (tamper-evident hash-chained ed25519-signed decision log for agents — `audit.Record` for decisions, `log.Info` for breadcrumbs).

**Security & crypto.** `stdlib/crypto` (`SHA256`/`HMAC`/`RandomToken`/`Equal`), `stdlib/validate` (pipe-style + `# kuki:validate "rules"` tag-driven; pairs with `parse.JSON of T from body`), `stdlib/random`, `stdlib/errors` as `errs` (`Wrap`/`Opaque`/`Is`/`NewPublic`).

**DevOps.** `stdlib/git` (via `gh`), `stdlib/semver`, `stdlib/obs`.

**AI & agents.** `stdlib/content` (unified `Content` variant enum re-exported by mcp + llm — Text/Thinking/Image/Audio/Link/Embedded/ToolUse/ToolResult/Reasoning; construct arms via `content.Text{...}`), `stdlib/llm` (shared schema builders + unified `StreamEvent` variant across providers), `stdlib/llm/chat`, `stdlib/llm/responses`, `stdlib/llm/anthropic` (same builder shape: `New |> System/User/Assistant |> Temperature/MaxTokens/Stream/Retry/AddTool |> Ask/Send/SendRaw`; chat-only: `AskJSON of T from prompt`, `AskStream`/`SendStream`), `stdlib/llm/embeddings` (OpenAI-compatible), `stdlib/llm/safe` (prompt-injection-resistant wrapping for adversarial input), `stdlib/mcp` (server + client; schema builders `Prop`/`Schema`/`Required`; `ToolWithOpts` for annotation hints — `ReadOnly`, `Destructive`, `Idempotent`, `OpenWorldHint`, `Title`; set `Enum` on a `SchemaProperty` to restrict allowed values), `stdlib/agentevent` (cross-agent normalized event shape — `AgentEvent` variant enum + `DecodeGooseEvent`/`DecodeClaudeCodeEvent` for goose + claude-code hook JSON; opencode bridges live in the host application).

```kukicha
# Typed JSON decode — `of T from x` is the explicit-type-arg syntax
repos := fetch.GetJSON of list of Repo from url onerr panic "{error}"

# LLM tool loop — same builder shape across chat/responses/anthropic
schema := llm.Schema(list of llm.SchemaProperty{llm.Prop("city", "string", "City")})
    |> llm.Required(list of string{"city"})
c := chat.New("openai:gpt-4o-mini")
    |> chat.AddTool("get_weather", "Get weather", schema)
    |> chat.User("Weather in Paris?")
comp := c |> chat.SendRaw onerr panic "{error}"
if chat.HasToolCalls(comp)
    handlers := make(map of string to func(string) string)
    handlers["get_weather"] = (args: string) => "Sunny, 22°C"
    c = chat.ExecuteToolCalls(c, comp, handlers) onerr panic "{error}"

# MCP server tool with typed args
mcp.Tool of PriceArgs(server, "get_price", "Get stock price", schema,
    func(args: PriceArgs) (any, error)
        return lookupPrice(args.Symbol), empty)

# ToolWithOpts — annotation hints + enum-restricted property
schema2 := mcp.Schema(list of mcp.SchemaProperty{
    {Name: "direction", Type: "string", Description: "Sort direction", Enum: list of any{"asc", "desc"}},
}) |> mcp.Required(list of string{"direction"})
mcp.ToolWithOpts of SortArgs(server, "sort_items", "Sort a list", schema2,
    mcp.ToolOpts{ReadOnly: true, Title: "Sort Items"},
    func(args: SortArgs) (any, error)
        return sortItems(args.Direction), empty)
```

**External packages** (separate Go modules, not bundled): `github.com/kukichalang/game` (WASM 2D), `github.com/kukichalang/infer` (ML inference, with `ort`/`webinfer` siblings). `go get` them like any Go dependency.

---

### Security — Compiler-Enforced Checks

The compiler **rejects** these patterns in HTTP handlers (functions with `http.ResponseWriter`):

| Pattern | Fix |
|---------|-----|
| `httphelper.HTML(w, nonLiteral)` | `httphelper.SafeHTML(w, content)` |
| `fetch.Get(url)` in handler | `fetch.SafeGet(url)` (or `fetch.NewExternal(url) \|> ... \|> Do()` for builder) |
| `files.Read(path)` in handler | `url.CleanPath(path)` first to reject `..`/`%2e%2e`/`%2f`, then `sandbox.New(root)` + `sandbox.Read(box, cleaned)` |
| `shell.Run("cmd {var}")` | `shell.Output("cmd", arg)` |
| `httphelper.Redirect(w, r, nonLiteral)` | `httphelper.SafeRedirect(w, r, url, "host")` |
| `html.Render("<script>...")` | Static `.js` file with `<script src="...">` |
| `regex.Match(userPattern, ...)` (non-literal pattern) | `regex.MatchSafe(pattern, text)` returns error, or hoist with `regex.MustCompile` at init + `regex.MatchCompiled` |
| `notify("https://{r.Host}/...")` / `f(r.Host)` (Host-header forgery) | Wrap handler with `httphelper.TrustedHosts(handler, allowed...)`, or compare `r.Host` to an allowlist before reading it |

`http.SafeRedirect` rejects non-`http`/`https` schemes (e.g. `javascript:`, `data:`, `file:`), protocol-relative `//host`, and bare relative paths: only allow-listed hosts on absolute http(s) URLs are permitted. `http.TrustedHosts(handler, allowed...)` is the middleware form: install it once at the edge and `r.Host` becomes trustworthy for every downstream handler. For client-IP behind a proxy, `http.RealIP(r, trustedProxies...)` parses `X-Forwarded-For` / `X-Real-Ip` only when `r.RemoteAddr` matches a trusted CIDR. `url.CleanPath` / `url.IsSubpath` normalize user-supplied paths before they hit a route table or filesystem (rejects `..`, `%2e%2e`, `%2f`, backslashes, NUL).

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

`kukicha pack weather.kuki` produces an [agentskills.io](https://agentskills.io/specification)-compliant directory:

```
skills/weather-service/
├── SKILL.md                    # frontmatter (name, description, metadata) + markdown body
└── scripts/
    └── weather-service.kuki    # source copy — no binary compilation
```

Agents invoke the skill by running the source at call time (no cross-compilation):

```bash
kukicha run scripts/weather-service.kuki <args>
```

Pass a directory to pack multi-file skills; all `.kuki` files (except tests) are copied under `scripts/<name>/`.

---

### Testing

Test files use `*_test.kuki` with the table-driven pattern:

```kukicha
petiole slice_test

import "stdlib/slice"
import "stdlib/test"
import "testing"

type TakeCase
    name    string
    n       int
    wantLen int

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

Assertions: `AssertEqual`, `AssertNotEqual`, `AssertTrue`, `AssertFalse`, `AssertNoError`, `AssertError`, `AssertNotEmpty`, `AssertNil`, `AssertNotNil`.

**Running tests.** There is no `kukicha test` subcommand — `go test` is the
runner. Build the package first so the transpiler emits fresh Go, then run
`go test` against the resulting directory:

```bash
kukicha build ./internal/foo/    # transpile + compile; produces foo.go + foo_test.go
go test ./internal/foo/...       # or go test ./... at the repo root
```

In CI, `kukicha build ./...` before `go test ./...` keeps the transpiled Go in
sync.

---

### Pitfalls

**WaitGroups: always `defer wg.Done()` as first goroutine statement.** Explicit `wg.Done()` at the end is skipped if the task panics, hanging `wg.Wait()` forever.

**Context cancel: defer in the function that uses the resource, not the one that creates it:**

```kukicha
# WRONG — cancel fires when buildCmd returns, context is dead before use
func buildCmd() reference exec.Cmd
    h := ctxpkg.WithTimeout(ctxpkg.Background(), 30 * time.Second)
    defer h.Cancel()
    return exec.CommandContext(h.Ctx, name, many args)

# CORRECT — defer in Execute, which owns the resource's lifetime
func Execute() Result
    h := ctxpkg.WithTimeout(ctxpkg.Background(), 30 * time.Second)
    defer h.Cancel()     # fires after Run()
    execCmd := exec.CommandContext(h.Ctx, name, many args)
    ...
```

`ctxpkg.WithTimeout` (and `WithCancel`/`WithDeadline`) returns a `Handle`
**by value**, not `reference Handle`. A helper signed
`func New() reference ctxpkg.Handle` won't compile against it — return the
bare type.

**Cleanup goroutines**: always provide a shutdown path (context or stop channel). Goroutines looping on a ticker leak if there's no stop signal.

**Never use `io.NopCloser` on a live response body**: it silences `Close()`, leaking TCP connections. Wrap with a type that delegates both `Read` and `Close`.


**`in` / `not in` are membership operators**: `x in xs` works on lists (element comparison), maps (key lookup), and strings (substring). For lists with non-comparable element types (slices, maps, funcs as elements), use `slice.Contains` with a custom predicate. `in` also still drives `for` loops.

**Signature smell — returns that all callers discard.** Rule 11 forbids `_ = call()` for sole-value discards, but multi-return destructuring (`_, err := f()`) is a different beast that the rule doesn't cover. When you find yourself writing it, check the other callers first: if two or more callers spell the same return slot as `_`, the signature is wrong. Drop the return rather than spreading discards across call sites. Common offenders: HTTP/RPC wrappers that return a status code nobody reads, helpers that surface an internal-bookkeeping value alongside the real result, and "and-related-thing" helpers (`loadFooAndBar`) where most callers only want one. Fix the signature, not the call sites.

---

### Troubleshooting

| Error | Fix |
|-------|-----|
| `use {error} not {err} inside onerr` | Change `{err}` to `{error}`, or use `onerr as e` |
| `variable 'x' not used` | Remove the variable, or use it; never use `_ = x` to suppress — remove the dead code instead |
| `function must declare return type` | Add explicit return type: `func F() int` |
| `onerr return requires return type` | Allowed in void funcs (bare early-exit) and error-returning funcs; in an `int`/other typed func, use `onerr discard` or add an explicit handler |
| `SSRF risk` / `path traversal` / `command injection` / `XSS risk` | See Security table above |
| `expected INDENT` | Check 4-space indentation (no tabs) |
| `expected 'when' or 'default'` | Use `when`/`default` |

<!-- kukicha:end -->
