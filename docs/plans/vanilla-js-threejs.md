# Vanilla JavaScript + WebGL2 for the Town Builder Web Client

> **Status**: Survey done, Phase 0 and **Phase 1 are done and committed on
> `main`** (see §4): an opt-in vanilla WebGL2 renderer ships behind
> `?renderer=webgl2`, flag-gated and default-off, with automatic fallback to
> Three.js on init failure. Phase 2 (visual parity / default-flip) is open.
> No release has been cut from this work; nothing ships unless the
> default-flip decision (§4) is made later.
>
> Current code state (2026-11-09): all of it is committed on `main`,
> flag-gated behind `?renderer=webgl2`, default-off. `static/js/webgl2/` —
> ~2,400 lines, **~24 KB gzip** vs the ~437 KB three.js stack (−94%);
> `tests/js/gltf-min.test.cjs` parses all 75 assets; verified end-to-end in
> Chrome (render, place, collide, pick/delete, clear-scene) with a clean
> console on both renderer paths. See §4 for what is and isn't verified —
> as of 2026-11-09, two Phase 2 parity bugs found by A/B are fixed,
> cross-renderer cursor sprites are verified, an all-75-asset A/B sweep
> (transforms, AABBs, category-status tint, drive-mode camera) is green on
> both renderers, the long-session GPU-leak soak shows both paths
> return to baseline GL object counts exactly, mobile/touch was
> emulated end-to-end (three touch-path bugs fixed), and the static route
> serves **content-hashed, immutable assets** under `/static/v/<hash>/`.
>
> Short answer: **yes — and in several structural respects this repo is a
> better candidate than the Babylon one. The runtime asset pipeline risk
> (75 glTF models the entire UI is built around) turned out to be
> manageable: the uniform minimal PBR/accessor subset was exactly as
> loadable as hoped, and the 75-asset test proves it on every run.**
>
> Surveyed November 9, 2026. All sizes measured locally on the working tree.

---

## 1. The premise, applied to this repo

The Babylon write-up's argument, in one line: the browser's built-in
platforms are vast and stable, and a bounded, mostly-emissive, small scene
can be replaced with a few thousand lines of plain JS + WebGL2 at a large
download saving, at the price of owning the graphics code.

Two things from the November 2026 landscape are directly relevant here:

- **Paul Ford, "The Web Is More Than Enough" (2026-10-21)** — the browser is
  powerful enough, and the cost of reaching for it keeps dropping (Simon
  Willison's Battle Drones, a multiplayer RTS, hosted on GitHub Pages).
- **Willison's three.js → vanilla WebGL2 Fabergé egg (2026-11-09)** — per his
  [weblog](https://simonwillison.net/), the [HN discussion](https://news.ycombinator.com/item?id=50416456)
  on Ford's piece, and the [Claude transcript](https://claude.ai/share/e56d163e-2793-4677-aa11-191d5058b414):
  the three.js version is **77 KB** (loading `three@0.170.0` from a CDN
  import map); the vanilla version is **~98 KB**, one self-contained file,
  hand-written PBR shader, shadow mapping, orbit controls, WebGL2 with a
  show-a-message fallback. Reported in the sibling repo's write-up on that
  thread (we could not independently re-verify the comments): **120ms
  INP (vanilla) vs 504ms (three.js)**; **2.6 MB vs 173 KB** total downloads;
  better M1 frame rates; features traded away (no glow, no real
  transparency). Note the honest detail: the vanilla file itself is *larger*
  than the three.js file — the win comes from not shipping the library.

The transferable lesson is the same one this repo can lean on: **for a
bounded scene, one developer (or agent) can replace a scene-graph library
with plain JS + WebGL2 and get a much smaller payload and faster page — at
the price of owning all the graphics code.** It is not "WebGL2 is magic."

### What Town Builder actually spends on Three.js

The web client (`static/`, served with **no build step**, no bundler, no
package.json anywhere in the repo) ships, via an import map in
`templates/index.html`:

| Asset | Raw | Gzip |
|---|---|---|
| `static/js/three.core.js` (three r181, unminified) | 1,405,971 B | 279,109 B |
| `static/js/three.module.js` (re-exports core) | 626,071 B | 126,241 B |
| `static/js/three/examples/jsm/loaders/GLTFLoader.js` | 114,883 B | 24,775 B |
| `static/js/three/examples/jsm/utils/BufferGeometryUtils.js` (imported *by* GLTFLoader) | 35,539 B | 8,039 B |
| **Three.js subtotal** | **2,182,464 B** | **~437 KB** |
| First-party JS (31 files, 8,045 lines) | ~325 KB | ~75 KB |
| Bootstrap (self-hosted: css + bundle js) | ~265 KB | ~54 KB |
| Go WASM physics (`physics_greentea.wasm` + `wasm_exec.js`) | 2.55 MB | ~753 KB |
| 3D models (75 × `.gltf` + `.bin` + `.png`, on demand) | 2.8 MB | n/a |

Context worth writing down before any decision:

- The three.js stack is **~85% of the JS payload by gzip** and is fetched
  eagerly on first paint (import map → `three.module.js` → `three.core.js`;
  `GLTFLoader` rides `models/loader.js` → `scene.js` → `main.js`).
- The **single largest JavaScript-adjacent payload is the physics WASM
  (~736 KB gzip), not Three.js**. If payload reduction is the goal, the WASM
  module is out of scope for this work but is the bigger fish.
- `static/wasm/calc.wasm` (1.7 MB) — **deleted in Phase 0**; it was
  unreferenced anywhere.

### What the three.js references actually are

515 raw `THREE.*` matches, but after removing vendored files only
**~140 references across 14 modules** survive, and only ~12 of those modules
use THREE at runtime (the rest are JSDoc type annotations: `category_status.js`,
`utils/disposal.js`, `mobile/controls-touch.js`, `state/*`). The real
runtime surface, by feature:

| Feature | Where | Replacement difficulty |
|---|---|---|
| Scene graph, `Object3D`/`Group` cloning | everywhere | mechanical (our own node struct) |
| `WebGLRenderer`, `Scene`, `PerspectiveCamera` | `scene/scene.js`, `scene.js` | core of the work |
| `MeshStandardMaterial` (PBR) + `scene.environment` + `PMREMGenerator` | `scene/scene.js` | **hard part** (see §4) |
| `ACESFilmicToneMapping` + exposure | `scene/scene.js` | ~20-line GLSL fit |
| `GLTFLoader` + LRU/bloom cache | `models/loader.js` | **hard part** (see §4) |
| `Box3.setFromObject`, AABB world bounds | `models/collision.js`, `utils/physics_wasm.js`, `scene.js` | moderate (8 corner transform) |
| `Raycaster` + `intersectObjects(..., recursive)` | `scene.js`, `utils/raycaster.js`, `models/placement.js`, `mobile/interactions-touch.js` | moderate (AABB prefilter, ray/tris for hits) — and a **perf win**: today this walks every triangle of every placed model per click |
| `Frustum`/`Matrix4` culling (hand-rolled already) | `scene.js` | math ports 1:1; three classes just wrap it |
| `Spherical` orbit math (custom camera, no OrbitControls) | `controls.js` | already ours; ports trivially |
| `GridHelper`, `CircleGeometry` (placement indicator) | `scene/scene.js`, `models/placement.js` | trivial |
| `Sprite`/`SpriteMaterial`/`CanvasTexture` (collaborative cursors) | `collaborative-cursors.js` | one quad + one texture |
| `ConeGeometry` (cursor mesh) | `collaborative-cursors.js` | trivial builder |
| `THREE.Timer` (delta time) | `scene.js` | trivial |
| `Spherical`/`Plane`/`Vector3` in touch controls | `mobile/interactions-touch.js` (3 spots) | trivial |
| `Group`, `AmbientLight`/`DirectionalLight`, `sRGBColorSpace`, `DoubleSide` | various | trivial |

**Unused in first-party code:** animation (no `AnimationMixer`, no clips — the
GLTFs contain **zero** animations), skinning/skeletons, morph targets,
instancing/`BatchedMesh`, `InstancedMesh`, shadow maps (`castShadow = false`
everywhere; the mobile graphics-quality setting that *could* enable shadows
dispatches an event nobody listens to), fog, post-processing
(`EffectComposer` — not present), audio (THREE.Audio — not used; there is
**no audio in this client at all**), loaders other than GLTFLoader, and
`BufferGeometryUtils` beyond GLTFLoader's static import of
`toTrianglesDrawMode` (all our primitives are `mode: 4` triangle lists, and
the import is unconditional so the 8 KB ships anyway).

### The assets, exactly

All 75 `.gltf` files (each with external `.bin` + one `.png`, one mesh, one
material) use an identical, minimal subset:

```
accessors:   VEC3 float32 (POSITION/NORMAL), VEC2 float32 (TEXCOORD_0),
             SCALAR uint16 (indices)
materials:   pbrMetallicRoughness { baseColorTexture, metallicFactor,
             roughnessFactor } only — nothing else
extensions:  none. KHR_*,
             no Draco/meshopt, no alphaMode, no doubleSided,
             no animations, no skins, no morph targets, no sparse accessors
images:      external .png, referenced by uri
```

This is about as close to "glTF as a rigid container for colored triangle
meshes" as the format gets. A purpose-built loader for this subset is a
realistic few hundred lines — not the ~2,000+ lines a general glTF loader is.

### What is already in good shape

- **First-party code is framework-free.** No React/Vue anywhere. DOM HUD is
  vanilla JS in `ui.js`/`main.js`; SSE via `EventSource` in `network.js`;
  state via plain modules.
- **Three.js itself is self-hosted** (vendored under `static/js/`, wired via
  import map) — no CDN dependency for the renderer, unlike the Babylon
  repo's `playground.babylonjs.com` assets.
- **The camera is hand-written** (`controls.js`, spherical orbit + driving
  camera) — no OrbitControls to port.
- **Frustum culling, spatial grid hooks, LRU model cache, bloom filter** —
  all hand-rolled already and expressed in portable math.
- **Physics lives in Go WASM** (`physics_greentea.wasm`) with a JS fallback
  in `controls.js`; JS collision uses AABB tests, which are trivial to
  reimplement (8 transformed corners).
- **A `node:test` harness already exists** (`tests/js/`, run via
  `./scripts/test-js.sh`, currently covering the SSE/layout logic with
  stubbed dependencies) — the sibling repo had *no* automated tests at all.
  We can extend this to cover the new loader (pure parse test, no GL
  context needed) and headless renderer math.
- **Bootstrap and fonts are self-hosted.** ~~The only third-party *runtime*
  CDN dependency in the whole client is `@atcute/*` from `esm.sh`~~ —
  **vendored in Phase 0** (`static/vendor/atcute/`); nothing external is
  fetched at runtime anymore except images/user content.

### What is not in good shape

- `static/wasm/calc.wasm` — 1.7 MB, **unreferenced**. Delete.
- No cache headers / content hashing on static assets (documented in the
  sibling write-up as well). Every deploy is a heuristic-cache gamble;
  matters more if/when we flip a renderer default.
- `mobile/interactions-touch.js` (576 lines) duplicates much of the desktop
  pick/place logic. Porting cost is paid twice unless we consolidate first.
- `three.core.js` is shipped **unminified** at 1.4 MB raw — we get no
  benefit from r186's removal of minified builds, and no tree-shaking
  without a bundler (which this repo deliberately does not use).
- The vendored r181 is **six releases behind** (r187, 2026-10-30) with no
  patches coming to r181; upgrading is possible but buys little without a
  build step (see §6).
- ~~`@atcute/*` loads from esm.sh at runtime~~ — **fixed in Phase 0**: all
  three packages vendored under `static/vendor/atcute/` (see §4).

---

## 2. The landscape as of November 2026

**WebGL2 is a safe, boring baseline.** Per caniuse (Sep 2026 data), WebGL2
is at ~97% global support and has been Baseline/widely-available since
Sept 2021; iOS Safari ≥ 15, all evergreen desktop browsers. This is the
right target for a no-build-step "plain JS" renderer today.

**WebGPU is no longer the experimental future — but WebGL2 remains the**
**compatible floor.** WebGPU shipped by default in Chrome/Edge 113+,
Firefox 141+ (Windows) / 145+ (Apple-silicon macOS; Linux/Android still
rolling out), and Safari 26 in September 2025 — including iOS, iPadOS and
visionOS. Both major web 3D libraries have gone WebGPU-first:

- **Three.js r187 (2026-10-30)** is current. Per release analysis,
  ~80% of changed lines in r185–r187 were the WebGPU renderer and TSL;
  r186 made WebGPU the default expectation, **removed the minified builds**
  ("let your bundler handle it") and removed `PCFSoftShadowMap`; the
  WebGLRenderer remains supported and gets fixes, but is no longer where
  the energy is. Our vendored r181 gets none of this regardless.
- **Babylon.js 9.33.x** is current (9.0 shipped 2026-03-26; the sibling
  repo is on 8.45.3 and is evaluating a move to 9.x — their problem).

Implication for us: if we go vanilla, authoring against **WebGL2 now**
keeps us on the universal floor; a WebGPU backend can follow later (and
this scene — small, flat-lit, stylized — would be an excellent WebGPU
first target). Do not attempt vanilla + WebGPU in phase 1. Also note: staying
on Three.js does not get us onto WebGPU either, because r186+ assumes a
bundler to realize any benefit.

**glTF is stable; dependency-free loaders are not a solved problem.**
glTF 2.0 is the universal runtime asset format. There is no mature,
actively-maintained, zero-dependency glTF loader in the browser —
`minimal-gltf-loader` (MIT, ~2016-era, depends on gl-matrix and XHR,
effectively unmaintained) is the usual reference and would need adaptation
itself. Practically, our options are: (a) write the ~500–800 lines for
our exact subset (recommended), or (b) repack the models offline into a
custom binary/atlas consumed by ~150 lines (bigger process change — new
asset tooling, new failure modes), or (c) vendor three's GLTFLoader
adapted to nothing, which doesn't work — it is three-coupled.

**Payload culture check.** The Willison egg is evidence for feasibility,
not for a blanket "libraries are dead" conclusion — his own takeaway was
that Claude Opus 5.5 *can* do 3D in vanilla WebGL without three.js, and he
still found the three.js code easier to read. The
[Ftrain comments](https://news.ycombinator.com/item?id=50416456) are, as
always, a full spectrum from "the web is enough" to "the web is a pile of
garbage"; the load-bearing facts for this decision are the size numbers
and the support tables above, not the rhetoric.

**`@atcute` / esm.sh.** ~~The only external runtime CDN dependency~~ —
vendored in Phase 0 (`static/vendor/atcute/`, all 0BSD-licensed). Nothing
is fetched from a third-party CDN at runtime anymore; keep it that way in
future changes.

---

## 3. Can we do it? Comparison to the Babylon write-up's situation

| Dimension | Babylon repo (per its write-up) | Town Builder (this repo) |
|---|---|---|
| Scene-graph library | Babylon 8.45.3 UMD, **1.66 MB gzip**, plus dead GUI/loaders | three.js r181 ES modules, **~437 KB gzip**, one live loader (GLTFLoader) |
| First-party JS | ~325 KB, 25 files, 9,311 lines | ~325 KB, 31 files, **8,045 lines** |
| 3D-coupled first-party | ~4,000 lines (~43%) | **~2,900 lines (~36%)**, and only ~1,500–2,000 of them are three.js-specific semantics |
| Framework-free first party | yes | **yes** |
| Assets at runtime | none (zero loaders needed; primitives only) | **75 glTF models, 2.8 MB** — the whole town UI is built around these |
| Material model | StandardMaterial mostly, glow faked | **MeshStandardMaterial + procedural PMREM env map + ACES tone mapping** — real PBR today |
| Shadows / post-FX / instancing | glow layer + bloom pipeline; shadows off | none — shadows off, no composer, no instancing |
| Camera | ArcRotateCamera → partially replaced with own | **already hand-written** (spherical orbit + drive cam) |
| Picking | one ray-pick | Raycaster vs `recursive:true` over everything — O(all triangles), a latent perf bug a port should fix |
| Audio | Web Audio, already raw | **none** |
| Tests for the 3D layer | none | **`node:test` harness exists**; can stub GL for math/loader tests |
| Build step | no | **no** |
| Mobile | touch handling present | ~1,050 lines of touch code, much of it duplicated desktop logic |
| WASM physics | n/a (game logic in JS) | yes (Go), AABB collision — portable math |
| Dead weight | GUI/loaders ~200 KB gz | `calc.wasm` 1.7 MB (unreferenced); `BufferGeometryUtils` (8 KB gz, required by GLTFLoader static import) |

### The honest hard parts (in order)

1. **A minimal glTF loader for exactly our subset** — buffers, bufferViews,
   accessors (float32 VEC3/VEC2/SCALAR-uint16, stride handling, sparse
   rejection with a clear error), one scene → nodes → mesh primitives,
   baseColorTexture + metallic/roughness factors, external images. Plus a
   validation pass that loads and renders all 75 assets (headless parse
   test in `node:test`; pixel-level check by hand/screenshot). Estimate:
   500–800 lines including tests.
2. **PBR parity without `PMREMGenerator`.** The current environment is a
   *procedural sky-gradient cubemap* prefiltered through PMREM. We do not
   need real importance sampling: an analytic hemisphere/gradient ambient
   term (irradiance from sky-to-ground gradient evaluated in the shader)
   reproduces this specific env map almost exactly. GGX + Lambert-ish
   rough diffuse + ACES fit. Estimate: 150–250 lines of GLSL + plumbing.
   Visual delta will be small but real; acceptance = eyeball + A/B flag.
3. **sRGB and texture orientation discipline** — baseColor PNGs are sRGB;
   flip handling, `UNPACK_FLIP_Y_WEBGL` leaks, and color-space tags must be
   right (the sibling repo hit exactly the flip-y leak).
4. **Math we must own**: column-major mat4, TRS, lookAt/proj, AABB world
   bounds, frustum from proj×view, sphere test for culling (or keep the
   existing box test). All standard; the sibling repo's `glmath.js` is
   ~230 lines and a template.
5. **Raycast replacement** — AABB prefilter then ray/triangle only for
   models under the cursor; fixes today's O(n·triangles) click cost.
6. **Port mechanics** — `scene.js` (528 lines) is an orchestrator, mostly
   portable; the GL objects get swapped under it.

Everything else is subtraction.

### The honest easy parts

- No audio, no animation, no skinning, no morph targets, no shadows, no
  post-processing, no instancing.
- Sprites: one quad with a canvas-generated texture for cursors.
- `GridHelper`: a few dozen line segments.
- Placement indicator: a circle mesh.
- `Timer`: 20 lines.
- Touch controls: port or, better, consolidate with desktop first.

---

## 4. What "doing it" would look like here

Staged exactly like the sibling repo's plan, adapted:

- **Phase 0 — free wins (done 2026-11-09)**
  - Deleted `static/wasm/calc.wasm` (1.7 MB dead, `git rm`'d; unreferenced).
  - Vendored `@atcute/*` instead of loading from esm.sh at runtime:
    `@atcute/oauth-browser-client@5.1.0` (self-contained bundle),
    `@atcute/client@5.1.2` (one import rewritten from the esm.sh absolute
    URL to relative `./lexicons-validations.mjs`),
    `@atcute/lexicons@2.1.1` validations bundle. All 0BSD. See
    `static/vendor/atcute/README.md`. Import map in `templates/index.html`
    updated; verified: `node --input-type=module` import smoke test passes
    (all exports the app uses are present, `xrpcSchemaGenerated` is boolean),
    all three files served 200 `application/javascript` by `go run ./cmd/server`,
    rendered page shows the local paths, `./scripts/test-js.sh` passes (19/19).
  - Tightened `script-src` in `internal/middleware/secheaders`: removed the
    `https://esm.sh` allowance (no longer needed once @atcute is vendored);
    package re-brewed, secheaders tests pass. This closes the supply-chain
    finding from `docs/SECURITY_REVIEW.md` (M2) completely.
  - Deferred: consolidating `mobile/interactions-touch.js` with the desktop
    pick path (still open — the touch pick now works and mirrors the
    desktop `findRootObject` semantics, but is not yet deduplicated);
    static cache headers / content hashing (base `no-cache` done in
    Phase 2; hashing only needed at the flip).
- **Phase 1 — opt-in spike (done 2026-11-09, `?renderer=webgl2`)**
  New `static/js/webgl2/` — ~2,400 lines across three files (committed on
  `main` in `202063e`), **~23 KB gzip** total vs the ~437 KB three.js
  stack (~94% smaller):

  | File | Lines | Role |
  |---|---|---|
  | `glmath.js` | 613 | vec2/vec3/quat/euler/mat3/mat4 (Gaussian-elimination inverse), Spherical, Ray, Plane |
  | `three-shim.js` | 1,430 | Drop-in for the used three.js surface: Object3D/Group/Scene/Mesh/Sprite, PerspectiveCamera, WebGLRenderer (GGX PBR + hemisphere IBL + ACES + sRGB), GridHelper, Raycaster (AABB-prefiltered ray/triangle), Frustum/Box3/Timer/Color/CanvasTexture |
  | `gltf-min.js` | 366 | Purpose-built loader for the exact asset subset (external .bin, VEC3/VEC2 float + uint16 indices, baseColorTexture + metallic/roughness factors, TRS nodes). Throws on anything else |

  Wiring: `ui.kuki` detects `?renderer=webgl2` server-side and `index.html`
  picks the shim for the `three` import-map entry (default path unchanged);
  first-party modules import bare `three`; `models/loader.js` dynamically
  imports the matching loader (gltf-min in vanilla, GLTFLoader otherwise);
  `main.js` falls back once per session to the default renderer if vanilla
  init throws; `scene/scene.js` skips the PMREM env map in vanilla mode
  (hemisphere ambient stands in).

  **Verified in-browser (Chrome) on `http://localhost:5001/?renderer=webgl2`:**
  scene renders (ground, grid, models) with pixel-comparable output to the
  default renderer; clean console (no errors) in both renderer paths;
  model place/collision-check/delete all work (delete verified on the
  building and on a moving vehicle); `node:test` suite green — including a
  test that parses **all 75 assets** with `gltf-min.js` (it caught a real
  bug: `readAccessor` didn't expose `count`).

  **Caught during bring-up (the real cost of owning the code):**
  `gl_` used as a variable name (reserved in GLSL — shader failed),
  plain JS arrays passed as index buffers (GPU "insufficient buffer size"),
  `lookAt` built the camera basis as rows instead of columns (projection
  landed off-center), and both hand-derived matrix inverses were wrong
  (replaced with Gaussian-elimination inverses, verified against identity
  and composed transforms). Plus a missing `getBasePath` import in `main.js`
  (pre-existing; crashed every page after init regardless of renderer) and
  missing `geometry.parameters` on the shim's primitive geometries.

  **Not yet verified (at time of Phase 1):** collaborative-cursor sprites
  (needs a second client), drive-mode camera follow, mobile/touch, long
  sessions, no automated 3D-layer screenshots. (All of these have since
  been verified in Phase 2 — see below; only CI screenshots remain open.
  Drive-mode *selection* uses the same raycast as Delete, which passes on a
  moving vehicle.)

  **Notable:** Chrome served a stale cached `gltf-min.js` after edits —
  the documented "no cache headers/hash busting" gotcha bit hard during
  development. Hard-reload (or content hashes, slated for the flip) is
  required during iteration.
- **Phase 2 — parity (~1 week)**
  - Screenshot A/B every model category; texture/color correctness;
    placement indicator, selection, hover, collision AABB vs three's
    `Box3.setFromObject`; long-session leak check (the LRU cache and
    cloned-model disposal paths must have vanilla equivalents of
    `geometry.dispose()`/`material.dispose()` — i.e., GL deletes).
  - 2026-11-09: the two correctness risks now have automated coverage —
    `tests/js/webgl2-disposal.test.cjs` drives the shim's GL disposal
    paths with a stub WebGL2 context (geometry VAO/buffer deletes,
    texture pending-delete flush, `disposeObject()` end-to-end) and
    `tests/js/webgl2-aabb.test.cjs` asserts vanilla `setFromObject()`
    matches Three.js `Box3.setFromObject()` for all 75 assets (plus
    `intersectsBox` agreement on 500 box pairs). 32/32 node tests green.
  - 2026-11-09: side-by-side A/B in Chrome (same browser, one tab per
    renderer, same synthetic mouse events at the same CSS coordinates)
    found and fixed two parity bugs (`83f822c`):
    `glmath.js` `setEulerFromQuaternion()` used a y-first decomposition
    while claiming XYZ order — composed matrices were fine (quaternion
    path), but drive-mode camera arrow keys and `saveScene`
    serialization read `rotation.*`, which was stale/wrong; replaced
    with Three.js's exact asin/atan2 XYZ branch and pinned with
    `tests/js/webgl2-glmath.test.cjs` (36/36 green). And the default
    three.js path never called `renderer.setClearColor()` at startup,
    so its sky rendered black until the user moved the sky picker —
    `scene/scene.js` now sets the picker default (#87ceeb) for both
    renderers. After the fixes the two tabs render identically: sky,
    ground, grid, placement, and identical world positions for placed
    models (to 1e-9). Pick/delete (raycast) works identically at the
    same screen coordinates in both. Cars diverge between the tabs as
    expected — collision response uses `Math.random()` — not a parity
    signal. The "Road Straight" and "Tree A" placements were rejected
    by the app's own overlap check in both renderers identically.
  - 2026-11-09: cross-renderer cursor sprites verified. Multiplayer
    fan-out requires Redis (`pubsub.Subscribe()` has no in-memory
    fallback — without Redis, SSE runs keepalive-only and **no**
    cursor/edit/delete/snapshot events reach other clients, all with
    200s); with `redis-server` running, a three.js tab's cursor
    renders on a vanilla tab as the cone + CanvasTexture label sprite
    with a clean console. Roadmap note: `storage.Initialize()` pings
    Redis once at startup and never retries — restart the dev server
    after starting Redis.
  - 2026-11-09: all-75-asset A/B sweep in Chrome (one tab per renderer,
    programmatic placement of **every** glTF on disk — including park and
    street categories, which had no prior A/B — at identical grid
    coordinates via `loadModel`, bypassing the UI). Result: for all 70
    non-vehicle assets, position/rotation/scale and `userData.boundingBox`
    are **bitwise identical** (max abs diff 0); child counts and frustum
    visibility match. Vehicles diverge as expected (live physics with
    `Math.random()` collision response) — not a parity signal. Both tabs
    render the same grid pixel-identically at a fixed camera, load all 75
    models with no failures, and log clean consoles (the webgl2 tab shows a
    benign transient WASM-ready retry warning). LRU eviction paths fire
    identically in both.
  - 2026-11-09: category-status tint path (`applyCategoryStatuses` —
    material clone + `color.setHex` + emissive clone, the app's only
    visual "highlight" mechanism) verified identical across renderers:
    11 tinted objects produce identical color/emissive/intensity values,
    and side-by-side screenshots match.
  - 2026-11-09: drive-mode camera-follow verified. `setDrivingCar` on a
    static placed object in both renderers with identical start camera:
    `updateDrivingCamera` converges both cameras to the exact third-person
    offset (0, 2.5, −6 in car space) — camera positions bitwise identical,
    look quaternions match to ~1e-9. (The interactive drive path was not
    exercised — this checks the camera math the interactive path drives.)
  - 2026-11-09: "Game-over overlay" was on the open list but **does not exist in this
    codebase** (no matches in JS/templates/backend) — nothing to verify;
    removed from the open list.
  - 2026-11-09: long-session GPU leak soak — symmetric place→render→delete
    cycles in one tab per renderer (WebGL context monkey-patched to count
    live buffers/VAOs/textures/programs; `renderer.info` sampled where
    available; JS heap via `performance.memory`). Two shapes: 12 rounds of
    a 6-model cycle and 2 cycles of all 75 models (forces the 75→50-entry
    LRU to evict). Results identical on both renderers:
    - **Every GL object created is deleted exactly once**: per round
      24 buffers / 6 textures / 6 VAOs created → all deleted; all-75 peak
      370–380 buffers / 75 textures / 95 VAOs → all deleted; create count
      equals delete count cumulatively. `renderer.info` returns to the
      15-geometries / 5-textures baseline every round. Three.js also
      churns (creates then deletes) one shader program per round; the
      vanilla path holds one shared cached program forever.
    - JS heap shows a GC sawtooth with no monotonic growth on either
      path (vanilla idles ~3.3–11 MB vs three ~7.8–19 MB).
    - LRU eviction path fires identically (both logs match); post-soak,
      previously-evicted models re-place and render correctly on both
      paths (verified visually and by placement).
    - Method note: models must be placed **in front of the camera** —
      three.js frustum-culls per object by default, so placements placed
      behind the camera never upload GL buffers there and would produce
      a falsely "flat" reading; the vanilla renderer has no per-object
      frustum cull at draw time (see note below).
    - Incidental perf observation: the vanilla renderer never drops
      off-screen models at draw time (three does, via the per-object
      `frustumCulled` default). The scene-level 100-object culling in
      `scene.js` still applies to both. Worth revisiting only if
      profiling shows overdraw matters; out of scope for parity.
  - 2026-11-09: mobile/touch — emulated iPhone (390×844 @3×, mobile UA +
    touch) in one tab per renderer, models placed programmatically, real
    synthetic TouchEvent sequences through the whole mobile pipeline. Found
    and fixed **three renderer-agnostic touch bugs** (pre-existing, in the
    shared hand-written mobile layer — desktop paths were unaffected, and
    the vanilla/three modules themselves were fine):
    1. `integration.js` `syncMode()` gated `touchInteractions.setMode()` on
       a nonexistent `isEnabled()` method → `touchInteractions.mode` was
       permanently `'place'`; **every** touch gesture was dead on mobile
       (tap, select, drag, rotate, delete). Added `isEnabled()` to
       `TouchInteractions`.
    2. `selectObjectAtTouch`/`deleteObjectAtTouch` collected only meshes
       with `userData.id` — but placed roots are Groups carrying
       `_isPlacedRoot`, children carry no `id`, so the pick set was
       always empty and selection/deletion could never hit. Now collects
       `_isPlacedRoot` roots and raycasts recursively, mirroring the
       desktop `findRootObject` path.
    3. In edit mode with an object selected, single/two-finger gestures
       were consumed by **both** the camera (pan/pinch) and the object
       (drag/rotate) — the camera panned while dragging an object, and
       pinched while rotating one. `controls-touch.js` now yields to
       `interactions-touch.js` when an edit-mode object gesture is active.
    Verified after the fix (both renderers, identical results):
    tap-select, object drag (identical landing coordinates, camera
    stationary), two-finger rotate (+45° on both), double-tap deselect,
    place-via-tap, delete-via-tap (confirm dialog auto-accepted),
    drive-select via tap→click with joystick shown, camera pan and pinch
    zoom in place mode (identical vectors; FOV 75→74.2 on both), mobile
    layout/FAB/tutorial render identically. Consoles clean on both.
    Note: this module has no unit tests (the node harness doesn't cover
    DOM/touch); verification is browser-emulation only.
    Incidental: the emulation work exposed that static files were served
    with no `Cache-Control`, and Chrome served **stale modules** even
    across `ignoreCache` reloads (per-renderer memory cache — the known
    "no cache headers" gotcha). The static route now sends
    `Cache-Control: no-cache` (revalidate-always, no content hashing yet).
  - 2026-11-09: content hashing for static assets (flip prereq, now done
    end-to-end). The static route computes a **tree content hash at startup**
    (SHA-256 over the sorted `path:hash` listing of `./static`) and serves
    versioned URLs as `/static/v/<hash>/<path>` with
    `Cache-Control: public, max-age=31536000, immutable`; wrong-version URLs
    404 rather than serve mismatched content under an immutable cache.
    Unversioned `/static/` remains as a `no-cache` fallback for any
    hardcoded path. Templates emit versioned URLs via a new `staticURL`
    func (all 10 references in `index.html`, including the import map and
    the WASM fetch); `window.__STATIC_VERSION__` is injected and
    `models/loader.js` builds the models base URL from it; the page is
    `no-store`, so a deploy's new hash rides the fresh HTML automatically.
    Verified: versioned assets return 200 + immutable; wrong version →
    404; unversioned → no-cache; models/`.bin`/textures/WASM/fonts all
    fetch versioned; both renderers place models through the real UI
    flow with versioned asset URLs; consoles clean. Note: version is
    computed once per process at startup — editing `./static` requires a
    server restart to re-hash (HTML is no-store, so reloads pick it up).
  - Still open: hover/selection highlight parity is effectively
    covered by the status-tint check (desktop has no separate hover
    visual), no automated 3D-layer screenshots in CI.
- **Decision gate — default flip**
  - Only after parity is boring in normal play: make vanilla the default,
    delete the three stack (2.1 MB raw / ~437 KB gz), remove the import
    map entries. Payload after flip ≈ **~75 KB gzip of app JS + ~54 KB
    bootstrap + WASM**, i.e. ~85% reduction of the JS layer.

**Recommendation**: proceed through Phase 0 at minimum; schedule Phase 1 as
a time-boxed spike with a go/no-go at the end. Do not skip Phase 0's
`@atcute` pin and dead-file delete — those are wins under every scenario.

**Not recommended**: upgrading three.js to r187 as a "halfway" step (no
payload win without a bundler we don't want; r181 is already far enough
behind that we'd be validating a new version anyway); adopting WebGPU for
phase 1; repacking assets offline (only if the minimal loader proves
unsound); or rewriting without the three.js fallback flag.

---

## 5. Risks and gotchas (this repo, specifically)

- **The 75-asset contract.** Our loader is only correct if *every* asset
  parses, including the `_withoutBase` variants (excluded server-side but
  present on disk) and any future model dropped into `static/models/`.
  The CI hook is a test that walks the directory — when someone adds a
  glTF with, say, a `normalTexture`, the test must fail loudly, not render
  silent garbage. Document the supported subset next to the loader.
- **Color space & Y-flip.** three tags `baseColorTexture` sRGB and flips
  textures; getting either wrong yields washed-out or upside-down models
  (sibling repo hit the `UNPACK_FLIP_Y_WEBGL` global-state leak — flip per
  upload, restore after).
- **Env-map fakery.** Hemisphere IBL ≠ PMREM, especially on metallic
  surfaces (the vehicles are the highest-metallic assets). Acceptable for
  this look; call it out in review rather than discovering it in photos.
- **Disposal semantics.** `utils/disposal.js` + `models/loader.js` assume
  three's dispose protocol; vanilla needs explicit GL buffer/texture
  deletes or the LRU cache leaks GPU memory across long sessions.
- **WASM spatial grid contract.** `utils/physics_wasm.js` serializes
  world AABBs via `Box3.setFromObject`; the vanilla AABB must match within
  collision epsilon or the car "bonks" at invisible offsets.
- **Importmap removal order.** ~~`@atcute` entries live in the same import
  map as `three`; remove them independently and carefully~~ — **done in
  Phase 0**: `@atcute` is vendored locally, so deleting the `three` import
  map entry at the flip no longer touches Bluesky sign-in. (The same order
  discipline applies to the eventual flip itself: vendor/remove `three`
  only when nothing else references it.)
- **Content hashing done (2026-11-09).** Assets are served immutably from
  `/static/v/<tree-hash>/` with stale-version URLs 404ing; HTML is
  `no-store`, so deploys flip cleanly. Remaining flip-blocker is just
  automated screenshots in CI.
- **Heuristic caching + no service worker** (no longer a flip hazard:
  versioned immutable URLs + `no-store` HTML, 2026-11-09). Verify with a
  normal reload at the flip; hard reloads stay useful during mixed-version
  rollout debugging.
- **Mobile duplication.** `interactions-touch.js` re-implements picking in
  three terms; porting it blindly doubles the bug surface — consolidate
  on the desktop pick path for both, or keep it on three until Phase 2.
- **The physics WASM stays.** Dropping three.js does nothing for the
  ~736 KB gz WASM; the 1.7 MB `calc.wasm` removal already shipped in
  Phase 0. Set expectations accordingly.
- **Line width is 1 px** (WebGL2 ignores `lineWidth` mostly) — fine for
  the grid; same caveat as the sibling write-up.
- **Empty-arm and map-iteration traps from the Kukicha side do not apply**
  here, but the repo's `AGENTS.md` rule that frontend JS has no build
  step does: keep every new file directly servable; no TypeScript, no
  modules beyond native ESM.

---

## 6. Options, scored

| Option | Payload effect | Effort | Risk | Verdict |
|---|---|---|---|---|
| A. Do nothing | 0 | 0 | r181 fossilizes | Worst long-term, zero cost now |
| B. Phase 0 (dead weight + vendor) | −1.7 MB raw; CDN dep removed | half day | trivial | **Done 2026-11-09** |
| C. Upgrade three r181 → r187 | ~0 (maybe worse; no min builds) | 2–4 days verify | moderate; validates a version we still can't tree-shake | Not recommended |
| D. Vanilla spike, keep three fallback (Phases 0–2) | −437 KB gz at flip | 3–4 weeks | moderate, contained by flag | **Phases 0–1 done; recommended path** |
| E. Vanilla + WebGPU first | −437 KB gz | 6–8+ weeks | high; Safari-26-only audience gate risk | No (revisit after D) |
| F. Offline model repack + tiny loader | −437 KB gz + faster parse | + tooling | new pipeline to maintain | Only if D's loader stumbles |

---

## 7. Bottom line

**Yes, we can convert — this codebase is an unusually good candidate, with
the caveat that the work is front-loaded on a purpose-built glTF subset
loader and a PBR/IBL shader pair, not on the scene graph (there is barely
any). The November 2026 landscape supports the move: WebGL2 is Baseline,
both major libraries have gone WebGPU-first (diminishing returns for our
use case under a no-build-step constraint), and the only precedent study
(Willison's egg, mirrored by the Babylon repo's in-flight conversion)
shows the pattern works — with measured wins in transfer size and INP, and
with features/gloss deliberately traded for simplicity.**

Versus the sibling write-up, we differ in kind, not degree: they could
*start writing shaders on day one*; we had to *own a small asset pipeline
first*. Phase 0 and Phase 1 (opt-in spike) are done; keep the three.js
fallback, and let the parity screenshots make the call on the flip.

### Appendix A — Reproduction

```bash
# serve the client (as today)
./scripts/dev.sh                       # or: go run ./cmd/server + proxy
# then open http://localhost:5001/?renderer=webgl2  (hard-reload once)
# or the default Three.js path at http://localhost:5001/
# sizes
gzip -c static/js/three.core.js | wc -c
gzip -c static/js/webgl2/three-shim.js | wc -c    # ~13 KB
find static/js -name '*.js' | grep -v -E 'three\.(core|module)\.js|three/examples|wasm_exec|webgl2' | xargs gzip -c | wc -c
# model subset audit
python3 - <<'EOF'
import json, glob, collections
c = collections.Counter()
for f in glob.glob('static/models/**/*.gltf', recursive=True):
    d = json.load(open(f))
    if d.get('animations') or d.get('skins'): c['ANIM/SKIN!'] += 1
    for m in d.get('materials', []):
        for k in m.get('pbrMetallicRoughness', {}): c['pbr:' + k] += 1
    assert not d.get('extensionsUsed'), f
print(c)
EOF
# JS tests
./scripts/test-js.sh
```

Reproducing the all-asset A/B sweep (done 2026-11-09): with the dev
server up and Redis running, open one tab per renderer
(`/` and `/?renderer=webgl2`), then in each tab evaluate a script that
imports `/static/js/state/scene-state.js` and `/static/js/models/loader.js`
and calls `loadModel()` for **every** `static/models/**/*.gltf` (build the
asset list with `find static/models -name '*.gltf'`) at deterministic grid
coordinates (e.g. 10 columns × 4.5 units spacing, rows centered on z=0),
then sets `camera.position.set(0, 62, 46)` + `camera.lookAt(0, 0, 0)` and
dumps `placedObjects` (position/rotation/scale/`userData.boundingBox`) for
comparison. `loadModel` does not POST, so the two tabs stay independent.
Compare the dumps pairwise — non-vehicle assets must match exactly (cars
drive on `Math.random()` and will diverge) — and screenshot both tabs for
the visual check. For the drive-mode camera check, `setDrivingCar(obj)` on
a static placed object and sample `camera.position`/`quaternion` after a
few seconds; both renderers converge to the car-space offset (0, 2.5, −6).
For the leak soak, open one tab per renderer, monkey-patch the context's
`create*/delete*` GL functions to count live objects, set the camera to the
(0, 62, 46) overview framing (anything behind the default camera never
uploads GL buffers in three.js), then place → wait ≥2 frames → delete via
the exact `handleDelete` sequence (`disposeObject` + `scene.remove` +
`placedObjects`/`movingCars` splice) in a loop; sample counts after each
round. Both paths must return exactly to baseline.

### Appendix B — Sources

- Paul Ford, *The Web Is More Than Enough*, 2026-10-21 — https://ftrain.com/aboard-the-web-is-more-than-enough
- Simon Willison on the HN thread (2026-11-09) — https://news.ycombinator.com/item?id=50416456
- Willison's write-up incl. the egg links — https://simonwillison.net/ (2026-11-09 entry)
- Claude transcript of the vanilla port — https://claude.ai/share/e56d163e-2793-4677-aa11-191d5058b414
- The sibling Babylon-repo write-up (VANILLA-JS.md, deleted from this
  repo's root in Phase 0; content not reproduced here) — premise,
  measurements as reported there, and the flip-y / 1 px line / stale-cache
  lessons referenced throughout.
- Can I use: WebGL2 2.0 (97%+ global, Sep 2026) — https://caniuse.com/webgl2
- MDN: WebGL2RenderingContext (Baseline widely available since 2021-09) — https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext
- three.js releases (r187, 2026-10-30; r186 removing minified builds) — https://github.com/mrdoob/three.js/releases
- Babylon.js 9.x (9.0 announced 2026-03-26; 9.33.0 current) — https://github.com/BabylonJS/Babylon.js/releases
- SpectorJS / WebGL2 fundamentals / `minimal-gltf-loader` (MIT, stale; subset loader expected to be written in-repo)
