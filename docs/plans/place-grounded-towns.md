# Place-grounded towns — research & plan

Notes from a teardown of [worldstrike.fun](https://worldstrike.fun/) (production JS
bundle, stylesheet, `credits.html`, and live API responses), filtered through what
this repo is actually trying to be. Cross-reference:
[`atproto-towns.md`](./atproto-towns.md).

## The reframe

`README.md` says "a web-based 3D town building application with real-time
multiplayer collaboration". The rest of the repo says something more specific:

- **The town is a real place.** `?town_id=` + `?code=` auth-code exchange
  (`internal/routes/ui/ui.kuki`) launches us from kibigia's "Design Town Layout"
  button; kibigia creates towns from a **map click** (`create_and_select_town`).
  Django returns `layout_data` plus `latitude`, `longitude`, `population`, `area`,
  `place_type`, `full_address`, `town_image`, `established_date`, `instance_id`.
  Those fields reach `static/js/state/app-state.js` via `loadTownFromDjango()` and
  are then never used by the renderer.
- **The town has civic meaning.** `static/js/category_status.js` maps ten
  wellbeing categories (clean water/air/land, grocery access, libraries, schools,
  low crime, green space, employment, affordable housing, transportation,
  healthcare) onto a 7-level Unknown→Excellent colour gradient applied to 3D
  models. kibigia derives the statuses from Bluesky posts.
- **Residents and AI agents co-design it.** `PROGRAMMATIC_API.md` is explicitly
  "for Claude Integration" (atomic batch ops, spatial queries, undo/redo,
  snapshots); `/api/scene/description` renders a natural-language summary.
- **It is meant to be owned and publicly viewable.** `atproto-towns.md`: towns
  tied to DIDs, layout in Redis/Django ("the knot"), snapshots in PDS blobs,
  read-only spectator gallery. The README credits [flo-bit/room](https://github.com/flo-bit/room)
  — a personal 3D space saved in your Bluesky account — as the inspiration.

So: **a persistent, identity-backed, portable 3D artifact representing one
specific real community, co-edited by residents and AI, embedded in a civic
platform, and viewable by anyone.**

World Strike is almost the opposite: an anonymous, session-based destruction
sandbox over *any* city, with one global world and 76 concurrent players. It is
useful as an engineering reference and as a warning about product fit.

> **Thesis:** the transferable lesson is not "add a map". It is *make the shared
> 3D artifact legible as a real place, and make it reconstructible from small,
> stable pointers*. Everything else about World Strike is game design.

## What World Strike actually does

| Layer | Implementation |
|---|---|
| 2D basemap | MapLibre GL JS + OpenFreeMap vector tiles (`tiles.openfreemap.org/planet`, OpenMapTiles schema), hand-written style, GeoNames city search proxied server-side |
| OSM data | **No Overpass/Nominatim in the client.** Server preprocesses OSM into versioned z14 Web Mercator JSON tiles: `GET /api/terrain/{x}/{y}?v=5` → `{key, buildings:[{rings,bounds,height,id,sourceId,tileKey}], water:[{rings}], roads:[{points,width,bridge}]}`. Client keeps a 3×3 neighbourhood, 18-tile LRU, in-flight dedupe, 10 s failure backoff |
| 3D world | Three.js `WebGLRenderer({canvas: map.getCanvas(), context: gl})` inside MapLibre custom `renderingMode:'3d'` layers, projecting Web Mercator metres via `defaultProjectionData.mainMatrix` — one canvas, one camera, one depth buffer |
| Multiplayer | WebSocket `/ws` after `/api/session`; 30 Hz tick, `input` with `seq`, `state` snapshots, client-side prediction + `rebase()`, 150 ms remote interpolation, `ping`/`pong` RTT |
| Persistence | Geometry-derived stable building IDs (`ofm-footprint-v2:<hash>@<tile>:<hash>`), damage state keyed by ID, rubble regenerated from a seeded LCG — no mesh ever crosses the wire |

Observed response sizes: one Amsterdam tile is **5.3 MB of JSON** (7,438
buildings, float64 metre coordinates) → **735 KB Brotli**, with
`cache-control: public, max-age=300` and `vary: Accept-Encoding`. Live
`/api/health`: `{"players":76,"tickHz":30,"tiles":362,"storage":"postgres",...}`.

Attribution is complete and visible: style `attribution` HTML chains
OpenFreeMap → OpenMapTiles → © OpenStreetMap contributors; footer repeats it;
`credits.html` documents every sound licence, the three.js MIT water normal,
GeoNames CC BY 4.0, and a disclaimer that AI-generated landmarks are
approximations. The `.js.map` returns 404.

## Decision matrix

| World Strike technique | Verdict here | Scoped to this product |
|---|---|---|
| Server-preprocessed, versioned OSM tiles + compression/cache headers | **Steal, shrink** | One town, not any city. Key the cache by `town_id`/lat-long, serve only footprints + water + roads near that town, quantize to decimetres. Reuse `ALLOWED_DOMAINS` and `internal/utils/security/` for the upstream, Redis for the cache. Target a few hundred KB, not megabytes. Go's `net/http` needs an explicit compression middleware. |
| MapLibre + OpenFreeMap basemap | **Steal as context layer** | Real footprints/streets/water are the *immutable existing reality*; placed models are *proposals* on top. Keep them as separate layers. World Strike hides OSM buildings to draw destructible ones — do **not** copy that; the existing-vs-proposed distinction is the point of a planning tool. A 2D inset/minimap is the low-risk entry given our free OrbitControls camera in `static/js/scene.js`. |
| Geometry-derived stable IDs + seeded procedural detail | **Steal the principle** | We already have server IDs + snapshots. The portable insight: a snapshot carries `{id, model, transform}` + `town_id` + geo, and **everything else regenerates from pointers** — ground, sky, basemap, display names. No meshes in the blob. This is what makes a PDS snapshot restorable on another host. |
| Single shared GL context via MapLibre custom layers | **Probably skip** | Elegant, but forces a MapLibre camera on a free-placement editor. Metre-anchored local frame (`1/cosh(y/(R/2π))` = `1/cos(lat)` scale correction) + separate 2D inset is the pragmatic version. |
| WebSocket @ 30 Hz, prediction, interpolation | **Only steal `seq` + `actor`** | Wrong consistency model: our edits are discrete, atomic, audited (batch/history/undo) and about to be owner-gated by DID. Keep SSE. |
| Granular `edit`/`delete`/`driver`/`name` SSE deltas | **Steal — already half-built** | Backend emits them (`internal/events/events.kuki` defines the enum; town/buildings routes broadcast them). The frontend ignored them — see "Phase 0" below. Fixed alongside this plan. |
| Shareable deep links + read-only view | **Steal for Phase 2** | `?town_id=84&snapshot=<id>` → static render from snapshot + basemap; no SSE, no presence, no Redis writes. Exactly the atproto plan's spectator/gallery requirement. |
| `drift:*` localStorage prefs | **Steal** | Direct precedent for atproto's "Play without login must stay available (progress in localStorage)". |
| Real daylight from lat/long + time | **Cheap win, low priority** | "The real sky over this place right now" is a strong legibility cue, but `category_status.js` already drives visual state and must stay dominant. |
| `/api/health` runtime metrics | **Cheap win** | `health.kuki` returns `{"status":"ok"}`. For a k8s/.gov deployment expose SSE client count, pub/sub lag, snapshot count. |
| ODbL attribution chain + credits page | **Non-negotiable** | Visible in the UI, not just the README. For a public atproto record, declare data provenance explicitly — "the record is a claim" extends to where its geometry came from. |
| City picker, geolocation, deploy dialog | **Reject** | `town_id` is the anchor; kibigia already chose the place before the iframe loads. |
| Destruction/damage, leaderboards, polls, tags, combat, "sinking" | **Reject** | Game mechanics. Drive mode is a minor inspection feature here. |
| One global persistent world | **Inverted** | World Strike works *because* it has one world. Our #1 blocker is the opposite: `const townKey = "town_data"` (`internal/storage/storage.kuki:13`) forces a single global town. |

## Mapping onto the atproto roadmap

The atproto plan already lists its blockers. This research changes what belongs
in each phase.

**Phase 0 — auth plumbing.** As planned: read `window.__TOKEN` → `setToken()`,
write the `auth_token` cookie, add `UserInfo.Did`. **Add:** apply the SSE delta
events in `static/js/network.js`, and put `seq` + `actor`/`did` on the SSE
envelope. Both are "the shared state isn't actually shared" bugs, and Phase 4's
ACL will need an actor stamp on every write. World Strike's `/api/session`
handshake before the socket is a precedent for the cookie path.

**Phase 1 — per-town storage.** As planned: `town_data:<townID>` +
`town_owner` index. **Add:** a town-scoped, versioned terrain cache in the same
storage layer, derived from `town_id`'s lat/long. Crucially, **the OSM backdrop
is derived data, not snapshot data** — snapshots capture only residents'
placements. That split keeps PDS blobs small and portable.

**Phase 2 — DID linking + public discovery.** As planned: atcute OAuth,
`org.kibigia.town` records, gallery endpoints. **Add:** the read-only spectator
render, shareable snapshot URLs, and localStorage for the anonymous editor.
World Strike's `structuredClone(style)` for a separate, cheaper view of the same
scene is a clean pattern for the gallery render.

**Phase 3 — snapshots → PDS blobs.** Apply the reconstructibility principle:
a snapshot is a compact state delta + `town_id` + geo; ground, sky, basemap and
display names all regenerate. World Strike proves a rich 3D scene can be rebuilt
this way (seeded rubble from a stable building ID, no mesh storage).

## New phase: ground the town in its real place

Not currently in any plan. Use the Django geo fields to fetch a small OSM
footprint/water/road context, render it as an immutable backdrop, and add visible
attribution.

Suggested shape, following the repo's `routes → services → storage` rule:

1. `internal/services/terrain/` — build a tile key from `town_id`'s lat/long
   (Web Mercator, z14 or coarser), fetch from an allowlisted provider, simplify
   polygons, quantize coordinates, cache in `storage` under
   `terrain:<townID>:<z>/<x>/<y>:v<N>`.
2. `internal/routes/terrain/` — `GET /api/terrain/{z}/{x}/{y}` with `Cache-Control`,
   `Vary: Accept-Encoding`, and a schema version for cache busting. Add the
   provider host to `ALLOWED_DOMAINS` and route the fetch through
   `internal/utils/security/`.
3. `static/js/` — a read-only ground layer in `scene/scene.js` (or a 2D inset),
   plus a visible attribution footer in `templates/index.html`.
4. Tests alongside the service: `<name>_test.kuki` brewed to `.go`, per
   `AGENTS.md`.

Design questions to settle before building:

- **Do user-placed buildings clash with real footprints?** They almost certainly
  will; a layer toggle ("existing" vs "proposed") is probably required, and it
  reinforces the product's core distinction.
- **Should spatial queries become geographic?** `PROGRAMMATIC_API.md` defines
  `/api/query/spatial/*` in arbitrary world units with 3D Euclidean distance.
  Anchoring the scene to real metres would let an AI co-designer answer "what's
  near the library" in geographic terms — a meaningful upgrade to the
  Claude-facing API rather than a cosmetic one.
- **Attribution and derived-data licensing.** OSM/ODbL requires visible credit;
  if a public atproto record references derived geometry, say so in the record.

## Known gap exposed by the delta work

`POST /api/town/save` (`internal/routes/town/town.kuki:104`) normalizes the
UI's array of `{category, modelName, position, rotation, scale}` but **does not
assign IDs**. Only the programmatic `/api/buildings` path (`newID()` in
`internal/routes/buildings/buildings.kuki:43`) generates them. Consequences:

- `broadcastSceneUpdate()` in `network.js` no-ops for UI-placed objects
  (`eventData.id` is undefined).
- A `full` SSE snapshot with no IDs cannot be reconciled incrementally — the
  old `loadTownData()` would **duplicate every object** on every client on every
  save.

`network.js` now handles this with index-based reconciliation (transform-only
update when the scene shape matches, full rebuild when it does not). The durable
fix is to **assign IDs on save** (server-side, or client-generated UUIDs echoed
back), which unlocks true incremental sync and makes every placement
attributable — a prerequisite for Phase 4's DID-gated ACLs. Track this as a
Phase 0/1 item.

## Deliberately not porting

- The 30 Hz WebSocket game loop, client prediction and interpolation. Smoothness
  under continuous motion is not the goal; correctness, auditability and
  ownership are. `batch`/`history`/`snapshots` are better primitives than
  `rebase()`.
- "Pick any city". The product is one town per `town_id`, chosen upstream.
- Hiding real OSM footprints to draw custom ones. They are context, not
  destructible props.
- 5 MB tiles into an iframe on a civic site. Quantize, compress, cache.
- Landmarks, damage, leaderboards, polls, spray tags, water shaders, combat
  audio. Let the fun parts wait until a town can actually be owned per-DID and
  two residents can see each other's edits.

## Tasks

- [x] Teardown of worldstrike.fun JS/OSM pipeline and live API shapes. *(this doc)*
- [x] Phase 0: apply `edit`/`delete`/`driver`/`name` SSE deltas; reconcile `full`
      snapshots without duplicating id-less objects. *(network.js)*
- [ ] Phase 0: `window.__TOKEN` → `setToken()`, `auth_token` cookie, `UserInfo.Did`.
- [ ] Phase 0: `seq` + `actor`/`did` on the SSE envelope (prereq for Phase 4 ACLs).
- [ ] Phase 0/1: assign stable IDs on `POST /api/town/save`; echo them to clients.
- [ ] Phase 1: per-town storage keys + `town_owner` index.
- [ ] Phase 1: enrich `/healthz` with SSE/pub-sub/snapshot metrics.
- [ ] Phase 2: atcute OAuth, `org.kibigia.town` records, gallery endpoints.
- [ ] Phase 2: read-only spectator render + shareable snapshot URLs + localStorage
      for anonymous editing.
- [ ] New phase: terrain service + route + immutable OSM backdrop + attribution.
- [ ] New phase: decide existing/proposed layer split and geographic spatial
      query semantics.
- [ ] Phase 3: snapshot = state delta + `town_id` + geo; regenerate everything else.
