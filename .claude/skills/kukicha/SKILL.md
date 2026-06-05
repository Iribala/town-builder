---
name: kukicha
description: Reference, anti-patterns, and Python-porting guide for writing Kukicha (.kuki) — a readable near-superset of Go. Use when authoring or editing .kuki files, porting Python to Kukicha, working with the Kukicha stdlib (stdlib/*), or running kukicha build/check/brew/fmt. Trigger on edits to *.kuki, on `petiole` declarations, or when the user mentions Kukicha, kuki, brew, onerr, pipes, enums, or porting from Python.
---

# Kukicha — reference + Python-porting guide

Kukicha is a near-superset of Go that reads more like Python/Swift/Rust: most
Go compiles unchanged, but a handful of constructs (`range`, `case`/`default`,
`struct {}`, `chan T`, `goto`, parenthesized `const ( ... )`) have Kukicha
replacements and won't parse in their Go form. **Always write Kukicha syntax**
(`and`/`or`/`not`, `equals`/`isnt`, `list of T`, `empty`, `onerr`, pipes, enums,
`name: Type` params) and use Kukicha's stdlib (`stdlib/*`) over raw Go packages.
Fall back to Go only when Kukicha has no equivalent. Reviewers reject PRs that
leave `&&`, `==`, `[]T`, `*T`, `nil`, or bare `name Type` params in `.kuki`
source when a Kukicha form exists.

> **This skill is shared by two Python-port projects** — `town-builder` and
> `race-to-the-crystal`. Examples drawn from a specific project are labeled
> *(illustrative, from <project>)*; the lesson is general even when the names
> are not. Where the two repos genuinely differ (notably the **edit loop**),
> both variants are documented and labeled.

---

## Porting from Python — read this first

Both of these codebases are ports of Python projects. The most damaging
mistakes aren't syntax — they're Python *concepts* carried over intact. The
transpiler accepts them, so nothing complains, but they throw away everything
Kukicha gives you over Python. **Translate the idea, not just the line.**

> **Rule of spirit:** if a piece of ported code still "thinks in dicts and
> strings," it isn't finished. The destination is named types — structs, enums,
> typed fields — checked by the compiler instead of re-validated by hand.

### 1. Python `dict` is not `map of string to any` — it's a struct (or enum)

This is the big one. In Python a `dict[str, Any]` is the universal container for
records, payloads, and kwargs. In Kukicha that role belongs to **structs** and
**variant enums**. A `map of string to any` should be rare — reserved for
genuinely dynamic, schema-less data (e.g. arbitrary decoded JSON you immediately
re-shape).

```kukicha
# WRONG — Python dict carried straight over  (illustrative, from race-to-the-crystal)
func best_attack(attacks: list of map of string to any) ChosenAction
    att_id, _ := chosen["attacker_id"]               # stringly-typed key
    dmg := cast.SmartInt(chosen["damage"]) onerr 0   # re-asserting type at use

# CORRECT — the schema already exists; use it
func best_attack(attacks: list of AttackActionResponse) ChosenAction
    att_id := chosen.attacker_id                     # typed field, no key lookup
    dmg := chosen.damage                             # already int, no cast
```

**Tell-tale symptom:** a cloud of `cast.SmartInt` / `cast.SmartString` /
`cast.SmartBool` and `x["key"]` lookups. Each one is a type you *threw away* at
the boundary and are now paying to recover. Decode `any` into a struct **once,
at the boundary** (JSON in, request in), then pass the struct everywhere
downstream.

### 2. Stringly-typed dispatch → variant or string-backed enum

```kukicha
# WRONG — Python string-tag dispatch
if action["type"] == "MOVE"
    ...
else if action["type"] == "ATTACK"
    ...

# CORRECT — string-backed enum (parse at the boundary), switch + when
switch action.type
    when ActionType.MOVE
        ...
    when ActionType.ATTACK
        ...
```

Extend this instinct to action types, phases, and any other "magic string" set.

### 3. Python `None` → `nullable reference T`, and prefer non-null by default

Python lets every value be `None`, so you guard defensively everywhere. Kukicha
makes nullability part of the type. A plain `reference T` is *statically
guaranteed* non-empty — no guard needed. Reach for `nullable reference T` only
when absence is real, and narrow once (`if x equals empty: return`) before
`dereference`. Don't reflexively make everything nullable "to be safe" — that's
the Python habit, and it forces guards the type system would otherwise spare you.

```kukicha
# Always narrow before dereference
cell := brd.get_cell(nx, ny)
if cell equals empty
    continue
dc := dereference cell   # safe: narrowed above
```

The compiler rejects `dereference x` unless `x` is narrowed in the current
branch by `if x isnt empty` or `if x equals empty: return/continue/break`.

### 4. `raise` / `try`/`except` → `onerr` + error returns

Python signals failure by raising. Kukicha returns errors and handles them at
the call site with `onerr`. A bare `panic` is the carried-over `raise` — replace
it with `return ..., error "..."` (or `onerr` at the call site). Reserve panic
for truly unrecoverable startup in `main`/`init`.

### 5. Python truthiness → explicit checks

`if mylist:` and `if not s:` have no Kukicha equivalent. Write the predicate:
`if len(mylist) > 0`, `if s equals ""`, `if ptr isnt empty`.

### 6. List comprehensions → `slice.Map` / `slice.Filter` + pipes

`[f(x) for x in xs if p(x)]` becomes a pipe of `slice.Filter` then `slice.Map`
with lambdas — readable, and idiomatic Kukicha:

```kukicha
names := effects
    |> slice.Filter(e => e.active)
    |> slice.Map(e => e.name)
```

---

## Anti-patterns observed in these ports

Recurring mistakes found in the generated `.kuki` files of both projects. Fix
them proactively; don't wait for a lint warning.

### 1. `==` and `!=` — the most common mistake

`equals` and `isnt` replace **every** `==` and `!=`, not just nil/empty checks.

```kukicha
# WRONG — Go operators leak into non-empty comparisons
if gs.phase == enums.PLAYING
if len(parts) != 3
if m == dest

# CORRECT
if gs.phase equals enums.PLAYING
if len(parts) isnt 3
if m equals dest
```

`equals`/`isnt` with `empty` is the one context this code usually gets right —
apply the same keyword to **all** comparisons.

### 2. Explicit type in list-literal elements

When the element type is inferrable from the outer literal, omit it. Same rule
for `append` calls and function arguments where the type is fixed by the
signature.

```kukicha
# WRONG
var DIRECTIONS = list of DirOffset{
    DirOffset{dx: -1, dy: -1},
    DirOffset{dx: 0,  dy: -1},
}

# CORRECT — inner type inferred from the outer `list of DirOffset`
var DIRECTIONS = list of DirOffset{
    {dx: -1, dy: -1},
    {dx: 0,  dy: -1},
}
```

### 3. `panic` — use errors instead

```kukicha
# WRONG — triggers the Kukicha lint warning
panic "health must be >= 0"

# CORRECT — return an error
func NewToken(...) (Token, error)
    if health < 0
        return Token{}, error "health must be >= 0"
```

### 4. Slice-typed fallback returns

```kukicha
# WRONG — string-to-slice cast is a Go-ism
result := decode(s) onerr return "" as list of byte

# CORRECT
result := decode(s) onerr return empty list of byte
```

---

## Getting Started

```kukicha
# hello.kuki — minimal program
import "stdlib/string"

func main()
    name := "world"
    print("Hello {string.ToUpper(name)}!")
```

Run: `kukicha run hello.kuki` · Build: `kukicha build hello.kuki`

**Multi-file packages:** `kukicha build myapp/` merges all `.kuki` files directly
in a directory into a single `main.go`. One file defines `func main()`; others
use `func init()`. All files need the same `petiole` declaration (Go's
`package`). Directory targets are shallow — subdirectories are their own
packages (`myapp/...` sweeps recursively).

## Syntax Reference

| Kukicha (write this) | Go equivalent (avoid in `.kuki` files) |
|----------------------|----------------------------------------|
| `and`, `or`, `not` | `&&`, `\|\|`, `!` |
| `equals`, `isnt` | `==`, `!=` |
| `empty` | `nil` |
| `list of string` | `[]string` |
| `map of string to int` | `map[string]int` |
| `reference User` / `reference of x` | `*User` / `&x` |
| `nullable reference User` | `*User` (may hold `empty`; guard before `dereference`) |
| `dereference ptr` | `*ptr` |
| `name: Type` (params, receivers, lambdas) | `name Type` (bare; parses but warns deprecated) |
| `func Method on t: T` | `func (t T) Method()` (Go-compat input, not idiomatic) |
| `many args: T` | `args ...T` |
| `make channel of T` | `make(chan T)` |
| `send val to ch` / `receive from ch` | `ch <- val` / `<-ch` |
| `when` / `default` | `case` / `default` |
| `for item in items` | `for _, item := range items` |
| `for i from 0 to 10` | `for i := 0; i < 10; i++` |
| `for i from 0 through 10` | `for i := 0; i <= 10; i++` |
| `empty list of T` | `nil` / `[]T(nil)` |
| `{field: val}` (type inferrable) | `T{field: val}` |
| 4-space indentation | `{ }` braces |

`func`/`var`/`const`/`enum` have aliases `function`/`variable`/`constant`/`enumeration`:
use the short forms in production code; reserve the long forms for
beginner/intermediate tutorials only.

### Constants

Declare one at a time with `const`. For a group of related constants —
especially sequential integers or string-backed labels — use `enum` instead
(the parenthesized `const ( ... )` form and `iota` are Go-only):

```kukicha
const PI = 3.14159
const MaxRetries int = 5
```

### Variables and Functions

```kukicha
count := 42           # inferred type
count = 100           # reassignment

var p reference int   # typed zero-value declaration (works locally too)
var xs list of string

func Add(a: int, b: int) int
    return a + b

func Divide(a: int, b: int) int, error
    if b equals 0
        return 0, error "division by zero"
    return a / b, empty

# Default parameter + named argument at call site
func Greet(name: string, greeting: string = "Hello") string
    return "{greeting}, {name}!"

result := Greet("Alice", greeting: "Hi")
files.Copy(from: src, to: dst)
```

### Strings and Interpolation

```kukicha
greeting := "Hello {name}!"          # {expr} is interpolated — replaces fmt.Sprintf
json := "key: \{value\}"             # \{ \} for literal braces
path := "{dir}\sep{file}"            # \sep → OS path separator at runtime

# Raw strings (backticks) — no escapes, no interpolation
prompt := `Reply JSON: {severity:1-5, kind, summary}`

# Escape sequences: \n \t \r \\ \" \' \xHH \0-\377
# Number literals: 42, 0xFF, 0o755, 0b1010, 3.14
```

### Types

```kukicha
type Repo
    name  string as "name"            # JSON field alias
    stars int    as "stargazers_count"
    tags  list of string

# Defined named type (distinct from base — needs explicit conversion: UserID(42))
type UserID int

# Function type alias
type Handler func(context.Context, string) (string, error)

# Transparent type alias (type X = Y — identical types, cross-package assertions work)
type TextContent = mcp.TextContent

# Use transparent aliases to tame long multi-token types in signatures.
# Rule of thumb: alias if the type repeats 3+ times in a file or pushes a
# signature past ~100 columns.
type UserMap = map of string to reference User

func MergeUsers(primary: UserMap, secondary: UserMap, overrides: list of UserMap) UserMap
```

### Enums

```kukicha
# Plain integer-backed (variants with no value)  (illustrative, from race-to-the-crystal)
enum GamePhase
    SETUP
    PLAYING
    ENDED

# Reference variants bare inside the package (PLAYING) or qualified (enums.PLAYING).
switch gs.phase
    when enums.PLAYING
        ...
    when enums.ENDED
        ...

# Explicit-value integer enum
enum Status
    OK = 200
    NotFound = 404
    Error = 500

status := Status.OK    # dot access → transpiles to StatusOK
```

- Underlying type (int or string) inferred from values; all must match
- Compiler warns on missing cases unless `default` present
- Integer enums warn if no case has value 0
- Auto-generated `String()` method

#### String-Backed Enums (`enum Name: string`)

For closed sets of string values. Compiler generates `String()` (raw value) and
a package-level `Parse<Name>` returning `(<Name>, bool)`. Parse at the boundary
so typos fail fast.

```kukicha
enum PlayerColor: string
    CYAN = "cyan"
    MAGENTA = "magenta"

c, ok := ParsePlayerColor(raw)
if not ok
    cli.Fatal("invalid color '{raw}'")
```

Prefer `switch` + `when` over a chain of `if color equals ...` for 3+ arms.

#### Variant Enums (Tagged Unions)

```kukicha
enum Shape
    Circle
        radius float64
    Rectangle
        width  float64
        height float64
    Point

func area(s: Shape) float64
    switch s as v
        when Circle
            return 3.14159 * v.radius * v.radius
        when Rectangle
            return v.width * v.height
        when Point
            return 0.0

# Single-case check with binding
if s is Circle as c
    return 3.14159 * c.radius * c.radius
```

- Cannot mix value cases (`= literal`) and variant cases in the same enum
- `is` for bool checks; `is CaseName as v` binds in `if` blocks (top-level condition only)
- **3+ arms → use `switch x as v` + `when` arms** (gets exhaustiveness checking).
  Sequential `if v is A` / `if v is B` / `if v is C` chains are a code-smell —
  convert to `switch`.

A variant enum may declare type parameters with `enum Name of T and E` (use
`and`, never commas):

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

- Construction (`Ok{Value: 5}`) infers type args from the surrounding return /
  var-decl / call-argument type. There is no explicit call-site syntax.
- Cross-package variants work with qualified names — `import "stdlib/result"`
  lets you write `result.Result of int and string`, `result.Ok{Value: 5}`, and
  `r is result.Ok as o`. The canonical fixture is `stdlib/result`.

### Methods

```kukicha
func Display on todo: Todo string
    return "{todo.id}: {todo.title}"

func SetDone on todo: reference Todo       # pointer receiver
    todo.done = true
```

### Error Handling (`onerr`)

`onerr` is for **fallible operations** — calls that can genuinely fail (I/O,
parsing, network, validation). Reach for it when the failure case is a real
error you want to recover from, propagate, or log.

For **expected absence** with a sensible default — env vars, slice index, map
key, find-by-predicate — prefer the package's `*Or` variant (`env.GetOr`,
`slice.GetOr`, `slice.FirstOr`, `slice.FindOr`, `maps.GetOr`). `pkg.XOr(args,
default)` reads as "give me X, or this default"; routing expected-absence
through `onerr` is a Python/Go-ism.

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

The caught error is always `{error}` — **never** `{err}`. Use `onerr as e` to
rename.

```kukicha
data := fetch.Get(url) onerr panic "failed: {error}"        # stop with message
data := fetch.Get(url) onerr return                         # propagate (raw, zero values)
data := fetch.Get(url) onerr return empty, error "{error}"  # propagate (wrap)
port := getPort()      onerr 8080                           # default value
riskyOp()              onerr discard                        # ignore (warns; test code only)
v    := parse(item)    onerr continue                       # skip in loop

# Named error for wrapping
data := parse(raw) onerr as e
    return empty, error "parse failed: {e}"

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

# Bare identifier as target
data |> print                     # → fmt.Println(data)

# Pipeline-level onerr — catches errors from any step
resp := fetch.Get(url) |> fetch.CheckStatus() onerr panic "{error}"
items := fetch.Json of list of Repo from resp onerr panic "{error}"

# Piped switch
user.Role |> switch
    when "admin"
        grantAccess()
    default
        checkPermissions()

# Tee a pipe value — `|> also as name` binds the upstream value into the
# enclosing scope and passes it through unchanged.
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

# Type switch — `switch x as v ... when T`
switch event as e
    when string
        print(e)
    when reference TaskEvent
        print(e.Status)

# `where` guard on a `when` clause. A guarded case does NOT cover its variant
# for exhaustiveness; add an unguarded `when X` fallback (or `default`).
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
```

### Collections and Literals

```kukicha
items  := list of string{"a", "b", "c"}
config := map of string to int{"port": 8080}
last   := items[-1]    # negative indexing

# Untyped literals — type inferred from context
func makeConfig() Config
    return {host: "localhost", port: 8080}    # inferred from return type

applyConfig({host: "prod", port: 443})        # inferred from parameter
```

Inference works in return statements, `onerr return`, function arguments,
assignments, and typed list elements.

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
    default
        print("nothing ready")
```

### Defer

```kukicha
defer resource.Close()

# Block form (emits defer func() { ... }())
defer
    if r := recover(); r != empty
        tx.Rollback()
        panic(r)
```

### Imports and Aliases

```kukicha
import "stdlib/slice"
import "stdlib/ctx"       as ctxpkg     # clashes with local 'ctx'
import "stdlib/db"        as dbpkg      # clashes with local 'db'
import "stdlib/string"    as strpkg     # clashes with 'string' type
import "stdlib/http"      as httphelper # clashes with 'net/http'

import "github.com/jackc/pgx/v5" as pgx  # external package

# Cross-package project types — alias to avoid collisions
# (illustrative, from race-to-the-crystal)
import "race-to-the-crystal/shared/enums" as enums
import "race-to-the-crystal/shared/types" as types
```

Always use these aliases when the package name clashes — collisions cause
compile errors.

## Commands

```bash
kukicha init [module]          # init project (go mod init + extract stdlib)
kukicha check file.kuki        # validate syntax
kukicha check --json file.kuki # JSON diagnostics
kukicha run file.kuki          # transpile + compile + run
kukicha build file.kuki        # compile to binary
kukicha build myapp/           # build directory
kukicha build --wasm file.kuki # WebAssembly output
kukicha fmt -w file.kuki       # format in place
kukicha fmt --check dir/       # check formatting (CI / pre-commit gate)
kukicha brew file.kuki         # convert .kuki to standalone Go
kukicha context myapp/         # project metadata as JSON (agents, IDEs, CI)
kukicha audit                  # vulnerability check
```

Run `kukicha fmt -w` before committing; CI should run `kukicha fmt --check`.

## Edit loop — two modes (pick the one your repo uses)

The two projects sharing this skill differ here. Identify which mode applies by
whether `.go` files are committed next to the `.kuki` sources.

**Mode A — source-only (no committed `.go`).** *Used by town-builder (0 committed
`.go`).* Edit the `.kuki` file, then:

1. `kukicha check internal/foo/foo.kuki` — fastest typed validator.
2. `kukicha build ./...` (or `kukicha run <entry>.kuki`) — final correctness check.

**Mode B — committed brewed `.go` alongside `.kuki`.** *Used by
race-to-the-crystal (~118 committed `.go`), so `go test` / `go build` work
without a build step.* After editing a `.kuki` file:

1. `kukicha check internal/foo/foo.kuki` — fastest typed validator. Use this
   first; **do not** rely on `kukicha brew --stdout | wc -c` as a proxy for
   success — brew can exit 0 with empty output when it gives up on a construct.
2. `kukicha brew --stdout internal/foo/foo.kuki > internal/foo/main.go` — refresh
   the committed Go. Directory-mode `kukicha brew internal/foo/` is unreliable
   (sometimes writes to `./main.go` or `./.go` in cwd); prefer the explicit
   `--stdout > target` form.
3. `go build ./...` — final correctness check across the whole module.

In **both** modes, run `kukicha fmt -w` before committing and never commit a
`.kuki` file that doesn't pass `kukicha check`.

---

## Stdlib Packages

Browse `.kukicha/stdlib/` for full API details (extracted by `kukicha init`).
Key functions below.

#### Collections & Strings

**slice**: `Filter`, `Reject`, `Partition`, `Map`, `GroupBy`, `Sort`, `SortBy`,
`First`, `Last`, `Contains`, `Unique`, `Chunk`, `Find`, `FindOr`, `Get`,
`GetOr`, `FirstOr`, `LastOr`, `Pop`, `Shift`, `Reverse`, `Concat`, `IndexOf`,
`IsEmpty`, `Sum`, `Min`, `Max`, `Average`

```kukicha
active := slice.Filter(items, x => x.active)
healthy, unhealthy := slice.Partition(items, x => x.ok)  # single pass, both halves
first  := slice.FirstOr(items, defaultVal)
total  := slice.Sum(scores)                              # ordered: ints, floats, strings
```

**maps**, **set**, **sort** — Go-equivalent helpers plus `sort.By`/`sort.ByKey`
for pipe-friendly sorts.

**string** (as `strpkg`) — standard string ops (`Split`, `Join`, `ToUpper`,
`Contains`, `Trim`, `Fields`, `Lines`, etc.) plus `IsBlank`, `OrDefault`,
`PadLeft`/`PadRight`.

**regex** — `Match`, `Find`, `FindAll`, `FindGroups`, `Replace`, `Split`;
pre-compile with `MustCompile` + `*Compiled` variants.

**iterator** — lazy `iter.Seq` chain: `Values`, `Filter`, `Map`, `FlatMap`,
`Take`, `Skip`, `Enumerate`, `Chunk`, `Zip`, `Reduce`, `Collect`, `Any`, `All`,
`Find`.

**cast** — `SmartInt`, `SmartFloat64`, `SmartBool`, `SmartString` (forgiving
coercion). *A cloud of these is the Python-dict smell — see Porting §1.*

#### Data & Encoding

**json** (as `jsonpkg`) — `Bytes`, `PrettyBytes`, `Parse`, `ParseInto`,
`Read`/`Write`, `Pretty`.

**parse** — typed decode with `parse.JSON of T from text` (also `YAML`, `Form`,
`Env`); plus `JSONLines`, `CSV`, `Lines`, `Int`, `Float64`, `Duration`, `URL`,
`Query`. JSON/YAML/Form/Env auto-run `Validate()` and return `(T, list of
validate.FieldError)`.

**encoding** — `Base64Encode`/`Decode`, `HexEncode`/`Decode`.

**template** — wrapper over `text/template`/`html/template`.

**markdown** — CommonMark + GFM → HTML via goldmark.

#### I/O & Files

**files**: `Read`, `ReadString`, `Write`, `Append`, `Exists`, `IsDir`, `Copy`,
`Move`, `Delete`, `List`, `ListRecursive`, `MkDirAll`, `TempFile`, `TempDir`,
`Join`, `Watch`

**archive** — zip + tar.gz, safe extraction (rejects zip-slip).

**sandbox** — filesystem jail for HTTP handlers: `New`, `Read`, `Write`, `List`,
`Exists`.

**shell** — subprocess helpers: `Run(literal)` (fixed string only),
`Output("cmd", arg...)`, `Lines`, `Check`, `Capture`; builder
`shell.New("cmd", args...) |> .Dir(d) |> .Output()`.

#### HTTP & Networking

**fetch**: HTTP client with builder, auth, retry, SSRF protection

```kukicha
repos := fetch.GetJson of list of Repo from url onerr panic "{error}"

resp := fetch.New(url)
    |> fetch.BearerAuth(token)
    |> fetch.Retry(3, 500)
    |> fetch.Do() onerr panic "{error}"
```

Key: `Get`, `SafeGet` (SSRF-safe), `Post`, `Json`, `Text`, `Bytes`,
`CheckStatus`, `New`/`NewExternal`/`BearerAuth`/`Timeout`/`Retry`/`Do`,
`DownloadTo`

**http** (as `httphelper`) — `JSON`, `JSONCreated`, `JSONNotFound`,
`JSONBadRequest`, `ReadJSONLimit`, `SafeRedirect`, `SetSecureHeaders`,
`SafeHTML`.

**html** — component rendering with auto-escaping.

**netguard** — SSRF guard. **shellguard** — subprocess allowlist (fail-closed).
**policy** — approval gate for agent ops (fail-closed).

#### CLI & System

**cli** — flag/subcommand parser. Prefer typed flag constructors
(`BoolFlag`/`IntFlag`/`StringFlag`) over the generic `AddFlag`.

```kukicha
listCmd := cli.NewCommand("list", "List items")
    |> .IntFlag("limit", "Max results", 20)
    |> .Action(doList)

cli.New("myapp")
    |> cli.Version("0.1.0")
    |> cli.WithCommands(listCmd)
    |> cli.Run() onerr cli.Fatal("{error}")
```

**input** — `ReadLine`, `Prompt`, `Confirm`, `Choose`; `NewForm` builder.
**table** — `New`, `AddRow`, `Print`, `PrintWithStyle`. **color** — ANSI styling.
**term** — single source of truth for tty/color/width. **log** — leveled
structured logger. **env** — typed env vars: `Get`, `GetOr`, `GetInt`,
`GetBool`, `Set`, `All`. **must** — panic-on-error startup helpers.

#### Concurrency & Resilience

**concurrent** — `Parallel`, `ParallelWithLimit`, `Map`, `MapWithLimit`, `Go`.
**ctx** (as `ctxpkg`) — `Background`, `WithTimeout`, `Cancel`, `Done`, `Value`.
**retry** — backoff + circuit breaker. **datetime** — `Format`, `Parse`, `Now`,
`AddDays`, `Seconds`, `Sleep`; constants `ISO8601`, `RFC3339`.

#### Data & Storage

**db** (as `dbpkg`) — SQL with struct scanning: `Open`, `Close`, `Query`,
`QueryRow`, `Exec`, `ScanAll`, `ScanOne`, `Transaction`, `Count`, `Exists`.
**sqlite** — convenience over SQLite (WAL, FK, busy timeout). **audit** —
tamper-evident hash-chained decision log.

#### Security & Crypto

**crypto** — `SHA256`, `HMAC`, `RandomToken`, `RandomBytes`, `Equal`
(constant-time). **validate** — pipe-style + tag-driven `# kuki:validate`.
**random** — `String`, `Alphanumeric`, `Int`, `Float`. **errors** (as `errs`) —
`Wrap`, `Opaque`, `Is`, `New`, `Join`, `NewPublic`, `Public`.

#### AI & Agents

**llm** + **llm/chat**, **llm/responses**, **llm/anthropic** — provider packages
sharing a builder shape (`New(model)` + role helpers + tuning + tools + send).
**llm/embeddings**, **llm/safe** (prompt-injection-resistant wrapping). **mcp** —
MCP server + client.

#### External Packages (separate modules)

**game** (WASM-only): 2D game lib — `github.com/kukichalang/game`.
**infer** / **ort** / **webinfer**: ML inference — `github.com/kukichalang/infer`.

---

## Security — Compiler-Enforced Checks

The compiler **rejects** these patterns in HTTP handlers (functions with
`http.ResponseWriter`):

| Pattern | Fix |
|---------|-----|
| `httphelper.HTML(w, nonLiteral)` | `httphelper.SafeHTML(w, content)` |
| `fetch.Get(url)` in handler | `fetch.SafeGet(url)` |
| `files.Read(path)` in handler | `sandbox.New(root)` + `sandbox.Read(box, path)` |
| `shell.Run("cmd {var}")` | `shell.Output("cmd", arg)` |
| `httphelper.Redirect(w, r, nonLiteral)` | `httphelper.SafeRedirect(w, r, url, "host")` |
| `regex.Match(userPattern, ...)` | `regex.MatchSafe(...)` or hoist with `MustCompile` |

---

## Testing

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
        {name: "3 elements", n: 3, wantLen: 3},
        {name: "n > length", n: 10, wantLen: 5},
    }
    for tc in cases
        t.Run(tc.name, (t: reference testing.T) =>
            result := slice.Take(items, tc.n)
            test.AssertEqual(t, len(result), tc.wantLen)
        )
```

Assertions: `AssertEqual`, `AssertNotEqual`, `AssertTrue`, `AssertFalse`,
`AssertNoError`, `AssertError`, `AssertNotEmpty`, `AssertNil`, `AssertNotNil`.

---

## Pitfalls

**WaitGroups: always `defer wg.Done()` as the first goroutine statement.**
Explicit `wg.Done()` at the end is skipped if the task panics, hanging
`wg.Wait()` forever.

**Context cancel: defer in the function that uses the resource, not the one that
creates it:**

```kukicha
# WRONG — cancel fires when buildCmd returns; context is dead before use
func buildCmd() reference exec.Cmd
    h := ctxpkg.WithTimeout(ctxpkg.Background(), 30 * time.Second)
    defer h.Cancel()
    return exec.CommandContext(h.Ctx, name, many args)

# CORRECT — defer in the function that owns the resource's lifetime
func Execute() Result
    h := ctxpkg.WithTimeout(ctxpkg.Background(), 30 * time.Second)
    defer h.Cancel()     # fires after Run()
    execCmd := exec.CommandContext(h.Ctx, name, many args)
    ...
```

**Cleanup goroutines**: always provide a shutdown path (context or stop
channel). Goroutines looping on a ticker leak without a stop signal.

**Never use `io.NopCloser` on a live response body**: it silences `Close()`,
leaking TCP connections.

**`in` / `not in` are membership operators**: `x in xs` works on lists (element
comparison), maps (key lookup), and strings (substring). For lists with
non-comparable element types, use `slice.Contains` with a predicate. `in` also
drives `for` loops.

---

## Project-local gotchas (general Kukicha tripwires)

Tripwires confirmed by hand against current Kukicha releases. These bit both
ports.

1. **`ctx.WithTimeout` returns `Handle` (value), not `*Handle`.** A helper
   returning `reference ctx.Handle` won't compile against it. Return the bare
   type.

2. **Type switch is `switch x as v ... when T`, not `switch v in x`.** The `in`
   form looks plausible but parses as a `for`-iteration expression and confuses
   the parser.

3. **`onerr` on external (non-stdlib) calls** errors with `cannot use onerr on
   call to X: return signature is unknown`. Annotate with `# kuki:returns N`
   above the call, or capture the error variable and check explicitly.

4. **External Go packages need explicit aliases on import.** `import
   "github.com/redis/go-redis/v9"` alone leaves `redis.X` undefined. Write
   `... as redis`.

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `use {error} not {err} inside onerr` | Change `{err}` to `{error}`, or use `onerr as e` |
| `variable 'x' not used` | Remove the variable, or use it; never `_ = x` to suppress |
| `function must declare return type` | Add explicit return type: `func F() int` |
| `onerr return requires return type` | Use `onerr discard`, or add return type |
| `SSRF risk` / `path traversal` / `command injection` / `XSS risk` | See Security table above |
| `expected INDENT` | Check 4-space indentation (no tabs) |
| `expected 'when' or 'default'` | Use `when`/`default` |
| `cannot dereference possibly-empty` | Narrow with `if x isnt empty` / `if x equals empty: return` first |

---

## Project module layouts (for orientation)

*race-to-the-crystal* (committed `.go` alongside `.kuki`; module
`race-to-the-crystal`):

```
shared/enums/     — CellType, GamePhase, TurnPhase, PlayerColor, Direction, …
shared/types/     — TokenID, PlayerID, Position, Pos()
shared/constants/ — board dimensions and tunable constants
shared/errs/      — project error values
game/             — board, token, player, combat, movement, crystal, AI logic
server/           — HTTP/WebSocket handlers, auth, lobby, coordinator
client/, web_server/
```

*town-builder* (source-only, no committed `.go`; module
`github.com/Iribala/town-builder`):

```
cmd/      — entry points
internal/ — game packages
```
