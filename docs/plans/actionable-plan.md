# Actionable Roadmap — Towns on atproto + Place-Grounded

Combined, dependency-ordered plan merging
[`atproto-towns.md`](./atproto-towns.md) (identity/ownership/snapshots/gallery)
and [`place-grounded-towns.md`](./place-grounded-towns.md) (SSE delta correctness,
per-town storage, real-place terrain, spectator view). Originals remain as
research; this file is the **execution checklist**.

Vision (one line): a persistent, identity-backed, portable 3D artifact
representing one specific real community, co-edited by residents and AI, and
viewable by anyone — with the town's real OSM context as an immutable
backdrop and its edits as attributable, owner-gated operations.

## Standing rules (from AGENTS.md / both plans)

- `routes → services → storage`. New code lives in `internal/services/<name>/`,
  `internal/routes/<name>/` (`.kuki` + brewed `.go` committed alongside).
- Always normalize layout data via `internal/normalization.NormalizeLayoutData`.
- Storage is Redis-primary with in-memory fallback (`storage.SetClient(empty)` +
  `storage.ResetMemory()` in tests; `httptest.NewServer` over `router.NewMux()`).
- Outbound HTTP / file paths go through `internal/utils/security/` and
  `settings.AllowedApiDomains`.
- Paths and stable IDs, not meshes, cross the wire or enter snapshots
  (reconstructibility principle).

## Status legend
- `[x]` done (as of current `main`)
- `[ ]` open
- `P?` = optional phase; ships only after its prerequisite

## Phase 0 — Auth plumbing + SSE correctness (blocker)

*Single shared foundation. Nothing else starts safely without it. Already
partially shipped: SSE deltas + no-duplicate reconciliation landed
(`network.js`).*

- [x] `static/js/`: read `window.__TOKEN` → `setToken(...)` in the boot path (main.js)
      (`setToken` imported in `network.js` but never called); write `auth_token`
      cookie alongside `userName` so `/events` works with JWT auth on.
- [x] `internal/services/auth/auth.kuki`: extend `UserInfo` with `Did`; trust a
      `did` claim on the JWT as identity when present.
- [x] Put `seq` + `actor`/`did` on the SSE envelope (events.kuki + routes).
- [x] Assign stable IDs in normalization/save (server-side mint when missing).
- [x] Apply `edit`/`delete`/`driver`/`name` SSE deltas + reconcile `full`
      without duplicating id-less objects (`static/js/network.js`).
- [ ] Tests: route integration for cookie/`Did` parsing; SSE envelope fields;
      save-with-IDs round-trip.

Acceptance: a signed-in user with real JWT auth enabled can load, edit, and
see SSE updates without 401s; every broadcast carries `seq` + `actor`.

## Phase 1 — Per-town storage + observability

*Unblocks N towns coexisting; replaces the global `townKey = "town_data"`
const. Prereq for linking (Phase 2) and terrain caching.*

- [x] `internal/storage/storage.kuki`: keyed `town_data:<townID>` (+ legacy global
      for empty id) and in-memory/Redis `town_owner:<townID> → did` helpers.
- [ ] Routes: `GET /api/towns/mine` (by `Authorization:` holder) and
      `GET /api/towns/by-owner/{did}`, falling through to
      `django_client.SearchTownByName` for legacy towns.
- [ ] Enrich `/healthz` (`internal/routes/health/...`) with SSE client count,
      pub/sub lag, snapshot count (cheap win; useful for k8s/.gov).
- [ ] Tests: multi-town isolation (storage unit tests); route tests with
      `SetForTest` + in-memory store.

Acceptance: two different `town_id`s never share state; `/healthz` reports
counts; legacy global town still readable.

## Phase 1B — Ground the town in its real place (terrain backdrop)

*Optional product track; can run parallel to Phase 2 after Phase 1 storage. The
OSM backdrop is derived data, not snapshot data (keeps PDS blobs small).*

- [x] `internal/services/terrain/`: Web Mercator `TileXY` + allowlisted
      `FetchTile` with Redis/memory cache and `SchemaVersion`.
- [x] `internal/routes/terrain/`: `GET /api/terrain/{z}/{x}/{y}` with
      `Cache-Control`, `Vary: Accept-Encoding`, schema-versioned cache keys and
      optional allowlisted `src` fetch.
- [x] Visible OSM attribution footer added in `templates/index.html`.
- [ ] `static/js/`: read-only ground layer / 2D inset in `scene/scene.js`
      (rendering integration still pending).
- [ ] Settle design questions: existing-vs-proposed layer toggle; whether
      `/api/query/spatial/*` upgrades to geographic (metre) units; derived-data
      licensing in public records.
- [ ] Tests: service unit tests (brewed `.go`); attribution present in template.

Acceptance: a town launched with lat/long renders an immutable OSM
footprints/water/roads backdrop with visible credit; snapshots remain small.

## Phase 2 — DID linking + public discovery (client OAuth)

*Depends on Phase 0/1. Ships ownership + gallery read side.*

- [ ] Frontend: `@atcute/oauth-browser-client` + `@atcute/client` as ESM
      imports in `static/js/`.
- [ ] Login flow: "Sign in with Bluesky" → `createAuthorizationUrl` → callback
      page at static route `/atproto/callback` → `finalizeAuthorization` →
      session keyed by DID in localStorage.
- [ ] After successful `POST /api/town/save` (Django `town_id`), client calls
      `com.atproto.repo.putRecord` collection `org.kibigia.town`, rkey `<townId>`,
      with CAS (`swapRecord: ex.Cid`, tangled pattern) to prevent clobbering.
- [ ] Save route accepts optional `ownerDid` → stores `town_owner:<townID>=<did>`.
- [ ] Unauth read endpoints (server-cached):
      - `GET /atproto/identity/{handle}` → `{did, pds}` (resolveHandle + PLC/DID-doc)
      - `GET /atproto/towns/{did}` → list `org.kibigia.town` records pointing at
        this server (`knot` matches our host); 404 when none.
      - `GET /atproto/view/{did}` → rendered town gallery page (the "see my room"
        equivalent).
- [ ] Frontend UX: sign-in banner w/ Bluesky-blue CTA (show
      `handle.bsky.social`); "Play without login" stays (localStorage `roomState`
      pattern); `get-your-own-town` landing page (Enter handle → preview PDS).
- [ ] Tests: identity resolution mocking; record list filtering by host.

Acceptance: a user can link a Bluesky account, save a town, and another visitor
can resolve handle → DID → list/view that town read-only.

## Phase 2.5 — DID bridging to kibigia (identity handoff)

*Can land with Phase 2 (claim-and-verify) or wait for upstream (did JWT).*

- [ ] Coordinate with kibigia upstream: `org.kibigia.*` domain ownership,
      `did` claim timing (their Spaces Phase 2), optional `Town.owner` mirror
      (`docs/plans/kibigia-coordination.md` exists — file as issue or fold into
      upstream repo).
- [x] Draft coordination message `docs/plans/kibigia-coordination.md`.
- [ ] Option A (preferred, upstream adds `did` claim to JWT — already on their
      roadmap): town-builder trusts DIDs from same trust anchor; `UserInfo.Did`
      receives them; `pds_url` on user skips PLC hop.
- [ ] Option B (independent of upstream, claim-and-verify): client sends
      `ownerDid` on save; server verifies out-of-band (resolve DID's PDS, read
      `org.kibigia.town/<townId>`, confirm `townId` + `knot`); ownership
      `pending` until verified (open behavior), owner-gated after; first verified
      record wins; re-claim requires owner `deleteRecord` (phase 5 observes via
      jetstream).
- [ ] Fallback if neither: record is display-only provenance.
- [ ] Onboarding seam: kibigia `launch_town_builder` redirect adds
      `?link_atproto=1` → `/atproto/link` page (room's OAuth dance), then POSTs
      resolved DID to `/api/towns/link`; popup/top-level when in iframe.

Acceptance: a town has an owner DID (verified or pending) without conflating
kibigia `username` (display/presence) with atproto `did` (ownership).

## Phase 3 — Server-side writes + snapshots → PDS blobs (P?)

*Depends on Phase 2. Optional; indigo only new dependency.*

- [ ] Confidential OAuth via indigo `atproto/auth/oauth`
      (`ClientApp` → `ProcessCallback`/`ResumeSession` → `ClientSession.DoWithAuth`;
      DPoP nonces + refresh), sessions cached in Redis (mirrors tangled recipe:
      Redis `ClientAuthStore` w/ expiry + inactivity TTL + small LRU).
- [ ] Serve `client-metadata.json` at `{{.RootPath}}/client-metadata.json`;
      JWKS at `/oauth/jwks.json`; dev mode via `NewLocalhostConfig` (127.0.0.1).
- [ ] `POST /api/snapshots`: zstd-encode → `uploadBlob` → `putRecord`
      `org.kibigia.town.snapshot` with blob ref; restore reads
      record → blob → existing `loadTown`. Reuse zstd dep; indigo is sole new dep.
- [ ] CAS (`swapRecord`) on record updates.
- [ ] spectator rendering from snapshot remains read-only / no SSE.

Acceptance: a server-held session can write ownership + snapshot records; a
snapshot restores identically.

## Phase 4 — Build permissions server-side (P?)

*Depends on Phase 0 (actor stamp) + Phase 1 (town_owner index).*

- [ ] `town_acl:<townID>` Redis set of DIDs (build permissions); checked in
      building/batch handlers.
- [ ] PDS `org.kibigia.town` carries `collaborators: [did…]` as **metadata
      only** (tangled v1.15 lesson — ACL lives in knot DB, not PDS records).
- [ ] Viewer distinction in UI: spectator (no session, static snapshot, no SSE)
      vs guest (kibigia JWT, gated writes) vs owner (JWT + linked DID, full).

Acceptance: non-owner writes rejected server-side; collaborator list is
display-only sync with Redis ACL.

## Phase 5 — Public gallery via jetstream (P?)

*Depends on Phase 2 + Phase 4 (optional).*

- [ ] Subscribe to jetstream filtered on `org.kibigia.town` (official client,
      `WantedCollections`, durable cursor, NSID switch), like tangled's
      `jetstream/jetstream.go`.
- [ ] Verify-don't-trust: confirm ownership of `townId` (describeRepo + owner
      endpoint) before listing; refuse unverified claims.
- [ ] Notify on ACL changes via jetstream ( observe owner `deleteRecord`).

Acceptance: public gallery lists verified towns on this server without scraping
user PDSes.

## Cross-cutting: tests & build

- Tests live next to subject as `<name>_test.kuki` (brewed `.go`) per
  AGENTS.md. Run `go test ./...` and `node --test tests/js/`.
- After editing any `.kuki`, brew `.go` alongside it (`scripts/brew.sh`
  convergence passes handle dependency order on fresh checkouts).
- WASM output must land at `static/wasm/physics_greentea.wasm`; build with
  `GOOS=js GOARCH=wasm kukicha build .`; clean stray `town-builder`/`main.go`
  artifacts.
- Docs: update `ARCHITECTURE.md` API list when adding routes.

## Critical path (shortest route to "owned, viewable town")

Phase 0 (auth + SSE seq + IDs) → Phase 1 (per-town storage) →
Phase 2 (client OAuth + record write + unauth reads) → Phase 2.5 bridging.
Everything after (terrain, server-side OAuth, ACLs, gallery, snapshots) is
layered on.

## Risks / notes (carried forward)

- `window.__TOKEN` auth is currently broken (imported, never called); shipping
  Phase 1 multi-town without Phase 0 re-exposes the 401 hole for real JWTs.
- Public surface widens in Phase 2 gallery — read only public-by-design
  paths; mount no SSE and no Redis write.
- Namespace pinned to kibigia's chosen `org.kibigia.*` root; verify domain
  control before first record write.
- Town record must stay tiny (metadata + pointers); layouts live in Redis/Django;
  snapshots only for full state.
- DID vs username must never be conflated: cursor/presence use `username`,
  ownership uses `did`. A JWT lacking `did` never proves/disproves atproto
  ownership.
- OSM backdrop: 5 MB tiles unacceptable for a civic iframe — quantize,
  compress, cache; visible attribution non-negotiable (ODbL).
- First-verified-record-wins concurrency in Phase 2.5 claim-and-verify.
- If embedded in iframe, atproto browser OAuth must pop out to top-level
  (third-party cookie blocking).

## References

- Research originals: `docs/plans/atproto-towns.md`, `docs/plans/place-grounded-towns.md`.
- WorldStrike teardown details (sizes, tile shapes, attribution): `place-grounded-towns.md` § "What World Strike actually does".
- tangled deep dive + verify-don't-trust: `atproto-towns.md` § "tangled.sh deep dive".
- kibigia trust model / JWT payload / Town model / upstream roadmap:
  `atproto-towns.md` § "The kibigia angle".
- Kibigia coordination draft: `docs/plans/kibigia-coordination.md`.
- Build/brew constraints: `AGENTS.md`.