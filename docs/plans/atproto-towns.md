# Towns on atproto — research & plan

Tie a town to an atproto (Bluesky) account, room-style. Research notes first (what
flo-bit and tangled.sh actually do), then a concrete plan for this repo.

## Prior art surveyed

| Project | Pattern | Stack |
|---|---|---|
| [flo-bit/room](https://github.com/flo-bit/room) | Tiny 3D rooms saved **in your bluesky account**. Browser-side atproto OAuth (`@atcute/oauth-browser-client`, public client, DPoP-bound tokens). Town state = one singleton record `dev.flo-bit.room` with rkey `self` via `com.atproto.repo.putRecord`. Viewing someone else's room = resolve handle→DID (public.api.bsky.app) → resolve PDS (plc.directory / did:web) → unauth `com.atproto.repo.getRecord`. No backend at all. | Svelte/Threlte + atcute, static hosting |
| [flo-bit/roomy-worlds](https://github.com/flo-bit/roomy-worlds) | Community 3D worlds (closest to town-builder: multiplayer editing, chat, per-cell instances with transforms). Uses **Jazz (CRDTs)**, not atproto, for world data — schema has `World.cells → InstanceList → Instance{path, model, transform{position/quaternion/scale}}`, plus chat `Space→Channel→Thread→Message` and `PlayerData` for live positions. | Svelte/Threlte + jazz-tools |
| [flo-bit/atmo-games](https://github.com/flo-bit/atmo-games) (Fours daily games) | Game state in users' atproto repos; **confidential** OAuth client (server-held signing key, granular `repo:<collection>` scopes); reads served from own AppView (contrail). | TS/Workers + contrail |
| [flo-bit/atmo-events](https://github.com/flo-bit/atmo-events) | `community.lexicon.calendar.event` + `community.lexicon.calendar.rsvp` records in user repos, indexed into D1 + Meilisearch by the app. | TS/Workers + contrail |
| [flo-bit/contrail](https://github.com/flo-bit/contrail) | Open-source AppView builder ("atproto backend in a bottle"): firehose/jetstream → D1/SQLite/PG, queryable, typed atcute clients. **Read-side only; never writes.** | TS |
| [tangled.sh](https://tangled.org) | Git forge on atproto. Identity/ownership = records in the user's PDS (`sh.tangled.repo` with `knot` hostname, issues, PRs, comments). **Heavy data (the actual git objects) lives on self-hostable "knots"** — acknowledging that atproto is public-data-only and not the place for multi-MB binaries. Rkey of the registration record = hostname. | Go (indigo, lexgen) |

### tangled.sh deep dive (source-level, from `tangled.org/core`)

Their mono-repo (`appview/` web service, `knotserver/` git hosts, `spindle/` CI,
`knot2/` Rust rewrite) is the closest Go-native reference for everything in this
plan. Findings below map 1:1 onto our phases — file refs are relative to
`tangled.org/core` (cloned via `https://tangled.org/@tangled.sh/core`, which
redirects to their own knot; note the repo name is just "core" and views use
`@<handle>/<name>` paths, not GitHub URLs).

**Auth (appview/oauth/)** — indigo's `atproto/auth/oauth` `ClientApp`, exactly the
library from our phase 3:

- Confidential client: Ed25519 multibase private key + JWKS endpoint
  (`/oauth/jwks.json`); client ID is a document URL
  `<baseUrl>/oauth/client-metadata.json` (`oauth.go:114`).
- Dev mode: `oauth.NewLocalhostConfig(...)` — and a warning that localhost must
  be `127.0.0.1`, not `localhost` (`oauth.go:107-110`). Matches our
  client-metadata gotcha below.
- **Granular scopes** (`appview/oauth/scopes.go`): `atproto` + one
  `repo:<nsid>` per collection they touch + `blob:*/*` +
  `rpc:<method>?aud=<did>` for knot/side-channel calls. Not the old
  `transition:generic` blanket.
- Sessions: Redis-backed `oauth.ClientAuthStore` (`store.go`, expiry 90d +
  inactivity TTL) + small LRU cache (`oauth.go:78-84`) + multi-account cookie
  registry. Sessions live in Redis *exactly like ours already do for JWTs and
  towns* — indigo supplies the DPoP/nonce/refresh machinery.
- Also has an **app-password fallback session** (`handler.go:331-400`, plain
  `com.atproto.server.createSession` + `putRecord`) used for *their own*
  service account, not for users — a pragmatic escape hatch worth remembering.

**Records & keys (lexicons/)**:

- `sh.tangled.knot` — registration record; **rkey = the knot's hostname**
  (`ingester.go:1160` `domain := e.Commit.RKey`); body just `createdAt`.
  Ownership verified out-of-band: appview calls
  `GET <knot>/xrpc/sh.tangled.owner` and compares the returned owner DID to the
  record's author DID (`appview/serververify/verify.go`).
- `sh.tangled.repo` — `knot` (host string) + name/description/topics required
  pattern; **rkey = repo name slug**, not TID.
- `sh.tangled.knot.member`, `sh.tangled.publicKey` — rkey = TID.
- Writes from their own appview go through the *user's* OAuth session with
  **conditional writes**: read the record first, then
  `RepoPutRecord{SwapRecord: ex.Cid}` (`appview/repo/repo.go:158-171`) — CAS so
  two writers can't clobber each other. Their fork flow demonstrates the full
  three-party dance: knot call → PDS `putRecord` (user session) → local DB
  write, with rollback/cleanup on each failure point (`repo.go:1440-1680`).
- Firehose ingestion (`appview/ingester.go` + `jetstream/jetstream.go`):
  official jetstream client filtered by `WantedCollections`, durable cursor,
  big switch on NSID → per-record handlers; account/identity events used to
  invalidate resolver caches. This is their "live gallery cache" — the
  mechanism behind any public "browse all repos" view.

**Verify-don't-trust**: records are read from the firehose, but the appview
independently confirms them with the server (and the server confirms the
record's `repoDid` owner via `describeRepo`, `ingester_repo.go:432-477`). A
PDS record alone is a *claim*; the app that hosts the resource completes the
loop.

**The counter-evidence for phase 4**: tangled originally stored knot
membership + per-repo collaborators as PDS records (`sh.tangled.knot.member`,
`sh.tangled.repo.collaborator`). As of v1.15 they **moved that ACL into the
knot's own DB** (served over XRPC); the appview now only ingests the legacy
records for history (`appview/ingester.go:1896-1925` marks
`repo.issue.comment`/`pull.comment` deprecated too). Lesson: fine-grained
permissions on public PDS records are awkward (everyone can read the ACL, and
consistency with enforcement is painful — for them enforcement is physical:
who may push git objects; for us it would be: who may place buildings).

**What to steal vs avoid, mapped to our phases:**

- Steal (phase 2): rkey = stable slug (`<townId>`), the ownership record
  pointing at a host field, unauth reads of the record for discovery.
- Steal (phase 3): indigo `ClientApp` + Redis store + LRU cache; granular
  scope list `repo:org.kibigia.town`, `repo:org.kibigia.town.snapshot`,
  `blob:*/*`; CAS `swapRecord` on record updates.
- Steal (phase 5, optional): jetstream subscription to `org.kibigia.town` as
  the sync bus for a *public* gallery — no scraping of user PDSes needed.
- Avoid: putting the ACL itself in the PDS record. Keep build permissions
  server-side (our Redis), with the PDS record carrying only ownership +
  metadata. tangled learned this the hard way in v1.15.

The shared pattern across everything:

1. **Identity = DID** (handle resolves to DID via DNS TXT / `resolveHandle`).
2. **Ownership proof = a record in the user's own PDS repo** — `at://<did>/<collection>/<rkey>`. Small, public, portable: any client can verify and read it without our servers.
3. **Heavy/scale data lives wherever the app can query it** (= our server), optionally mirrored/cached server-side ("AppView").
4. **Snapshot semantics**: this repo's existing pattern (`town_snapshot:<id>` zstd blobs + meta list) maps directly onto PDS blobs + record metadata.

So "a city tied to an atproto account" in the wild looks like a record such as
`sh.tangled.repo` or an event in `community.lexicon.calendar.event` — except
room is the only one that puts full object data in the PDS, and room's data is
a few KB. A full town layout is the "git objects" case: it belongs on the app
server (our "knot"), with the PDS holding ownership + snapshots.

## What town-builder has today

- Identity: JWT `username`/`sub` claim → `UserInfo.Username` (`internal/services/auth/auth.kuki`), no DID, no per-user state. Tokens come from the upstream kibigia/Django service or, in dev, `dev-user`.
- Storage: **one global town** — `townKey = "town_data"` const, zstd JSON blob in Redis; snapshots/history global too. Multiplayer is per-tab presence (`static/js/main.js` self-reported name, cursor u.Username).
- Town create/update: `POST /api/town/save` — normalize → local JSON → Redis → Django (`town_id` if provided, else name-search, else `CreateTown`). Town identity today = Django `town_id`, surfaced to client via `window.currentTownId`.
- Read-back from Django: `GET /api/town/load-from-django/{id}` → `{id,name,description,lat,long,category_statuses}`.
- Frontend auth is **currently broken** — `window.__TOKEN` is embedded in `templates/index.html:356-372` but never read into `app-state.token` (`setToken` imported in `static/js/network.js:9`, never called); with real JWT auth on, the UI would 401.

## Design: tie a town to a DID

Three layers, each with a different owner (mirrors tangled's split):

```
live state (Redis, realtime multiplayer)        ← town-builder server ("the knot")
ownership/name/metadata (small records)         ← user's PDS, collection <our-app>.town
snapshots (zstd JSON blobs)                     ← user's PDS blobs, referenced by record
```

### Lexicon

NSIDs follow kibigia's already-chosen lexicon root (`org.kibigia.*` from its
ATProto-Spaces roadmap — one namespace for governance records and towns):

```
org.kibigia.town            # ownership/metadata record
org.kibigia.town.snapshot   # snapshot metadata + blob ref (phase 3)
```

Record (single `town` record per town, rkey = TID or stable slug):

```jsonc
{
  "$type": "org.kibigia.town",
  "townId":   "84",                          // django town_id (canonical for data)
  "instance": "springfield-main",            // kibigia Town.instance_id (multi-instance)
  "uri":      "https://<host>/?town_id=84",
  "knot":     "town-builder.example.com",    // our server = tangled's knot host pointer
  "name": "Riverside",
  "description": "",
  "latitude": 48.86, "longitude": 2.35,
  "population": 1234,
  "createdAt": "...", "updatedAt": "..."
}
```

`knot` is the tangled-style indirection: the record in your PDS is the source of
truth for *who owns what*, and points at the server that stores/handles the
layout. Anyone can read `listRecords?collection=org.kibigia.town&repo=<did>`
without our involvement.

### Options considered

| Option | Saves to PDS written by | Pro | Con |
|---|---|---|---|
| **A. room-style, all client-side** | Browser via atcute OAuth public client | Zero server crypto (atcute does everything in JS); parallel-repo pattern we can port directly | Server can't write records; saves only happen while user online; multiplayer state shape split across two owners |
| **B. server-side OAuth (confidential, DPoP)** | Our Go server via indigo `atproto/auth/oauth` (`ProcessCallback`/`ResumeSession`/`DoWithAuth`) | Server writes records on every `POST /api/town/save`; works with the existing server-relayed multiplayer; sessions live in Redis like everything else | Must host `client-metadata.json`, persist OAuth session per DID, handle DPoP/nonces; bigger surface |
| **C. tangled-model, ownership records only** | Client via OAuth (small record) | No extra config beyond A; town data is single-source-of-truth on our server (already true) | Snapshots to PDS are an extra step if wanted |

**Recommendation: C for phase 1 with A's client OAuth, B for phase 3.** Start
with ownership-only records written from the browser (room's exact write-call
pattern, `putRecord`), read-back/discovery open to anyone, and leave
server-side writes + snapshot sync to a later phase (indigo's oauth pkg keeps
it accessible from Go).

### Concretely, in this repo

**Phase 0 — unblock auth plumbing (bug-level prerequisite)**
- `static/js/`: read `window.__TOKEN` → `setToken(...)` in the boot path
  (`setToken` is imported in `network.js` but never called today); write the
  `auth_token` cookie alongside the existing `userName` cookie so `/events`
  works with JWTs on.
- `internal/services/auth/auth.kuki`: extend `UserInfo` with `Did`; when the
  JWT carries a `did` claim, use it as identity.

**Phase 1 — per-town storage + ownership index (no atproto write path yet)**
- `internal/storage/storage.kuki`: parameterize the `townKey` const →
  `town_data:<townID>`, plus an index `town_owner:<townID> → did`, so N towns
  can coexist (the const today forces one global town).
- Routes: `GET /api/towns/mine` (towns owned by the `Authorization:` holder)
  and `GET /api/towns/by-owner/{did}` (owned by a given DID, from the index),
  falling through to `django_client.SearchTownByName` for legacy towns.

**Phase 2 — link a town to a DID (client OAuth)**
- Frontend: `@atcute/oauth-browser-client` + `@atcute/client` as ESM imports in
  `static/js/` (no bundler needed).
- Login flow: "Sign in with Bluesky" → `createAuthorizationUrl` → callback
  page (static route `/atproto/callback`) → `finalizeAuthorization` → session
  keyed by DID in localStorage.
- Write: after a successful `POST /api/town/save` (Django returns `town_id`),
  the client calls `com.atproto.repo.putRecord` with `collection=org.kibigia.town`,
  rkey = `<townId>` slug, conditional on updates (tangled reads the record
  then re-puts with `swapRecord: ex.Cid` — port that CAS so two writers can't
  clobber). Same `putRecord` + blob pattern room uses.
- Server: save route accepts an optional `ownerDid` field → stores
  `town_owner:<townID>=<did>`; cursor events can carry it for display.
- Unauth reads (mirroring room's `getRoom` pattern, server-cached):
  - `GET /atproto/identity/{handle}` → `{did, pds}` (proxy to `resolveHandle`
    + PLC/DID-doc lookup).
  - `GET /atproto/towns/{did}` → list resolved `org.kibigia.town` records
    pointing at this server (`knot` field matches our host) — 404 when none,
    like room's planned "room not found" error.
  - `GET /atproto/view/{did}` → rendered "town gallery" page (the "see my
    room" equivalent).

**Phase 3 — server-side writes + snapshots in the user's repo (optional)**
- Confidential OAuth with
  [indigo atproto/auth/oauth](https://pkg.go.dev/github.com/bluesky-social/indigo/atproto/auth/oauth)
  (`ClientApp` → `ProcessCallback`/`ResumeSession` → `ClientSession.DoWithAuth`
  handles DPoP nonces and refresh); sessions cached in Redis. tangled's exact
  recipe: Redis-backed `ClientAuthStore` (expiry + inactivity TTLs) plus a
  small LRU session cache, confidential client with JWKS at
  `/oauth/jwks.json`, dev mode via `NewLocalhostConfig` (127.0.0.1, not
  `localhost`).
- Serve `client-metadata.json` at `{{.RootPath}}/client-metadata.json`.
- On `POST /api/snapshots`: zstd-encode → `com.atproto.repo.uploadBlob` →
  `putRecord` `org.kibigia.town.snapshot` with the blob ref; restore path reads
  record → blob → existing `loadTown`. Reuses the zstd dependency already in
  go.mod; indigo is the only new dependency.

**Phase 4 — build permissions, server-side (optional)**
- Add `collaborators: [did…]` to the `town` record *as metadata only*; actual
  build-permission checks live in our Redis (`town_acl:<townID>` set of DIDs
  checked in building/batch handlers). tangled migrated precisely this ACL
  **out of PDS records into their knot's DB** in v1.15 (`sh.tangled.knot.member`
  is now legacy, ingested only for history) — public per-object ACL records
  proved awkward, so their appview keeps listing today's knot membership
  in its own database. Mirrors tangled's `sh.tangled.repo.collaborator`
  idea but with enforcement staying on the app server.

**Phase 5 — public gallery via jetstream (optional)**
- Subscribe to jetstream filtered on `org.kibigia.town` (tangled's
  `jetstream/jetstream.go` pattern: official client, `WantedCollections`,
  durable cursor, NSID switch) → keep a public "towns on this server" index
  with verify-don't-trust semantics: a record is a claim, our server confirms
  ownership of `townId` before listing (tangled double-checks repo ownership
  via `describeRepo` + owner endpoint for exactly this reason).

### Frontend UX rows (validated against room's TODO list)

- Sign-in banner w/ Bluesky-blue CTA — show `handle.bsky.social` when known.
- "Play without login" mode must stay available (progress saved to localStorage — room does exactly this: saved locally **and/or** in your account).
- `get-your-own-town` landing page: `Enter handle` → preview function = read PDS records; this is exactly room's "modal for first visit → create your own room / see my room" flow.

## Viewer sessions & the kibigia trust model

### How flo-bit/room actually handles sessions (from source)

Room has **three session states living side by side**, and none of them ever
touches a server of flo-bit's own:

1. **Anonymous editor** — no OAuth at all. No `?handle` in the URL → load room
   state from localStorage (`roomState` key, `editorState.svelte.ts:107`),
   straight into the editor. A visitor without an account gets a complete
   editor with local-only persistence.
2. **Owner (signed in)** — atcute OAuth public client
   (`src/lib/oauth/const.ts`: `token_endpoint_auth_method: 'none'`,
   `dpop_bound_access_tokens: true`, scope `atproto transition:generic` — the
   *legacy* broad scope; flo-bit's later apps use granular ones). Bootstrap
   order in `initClient()`: URL-hash OAuth callback params →
   `finalizeAuthorization`; else localStorage `last-login` (the DID) →
   `getSession(did, { allowStale: true })` resume. Profile (handle, avatar) is
   fetched once via `app.bsky.actor.getProfile` on `public.api.bsky.app` and
   cached in localStorage under `profile-<did>`.
3. **Viewer of someone else's room** — **no atproto session required at all**.
   `?handle=someone.bsky.social` → `resolveHandle` (public API, unauth) →
   `getRoom({did})`: resolve PDS via `plc.directory` / `did:web` doc → unauth
   `com.atproto.repo.getRecord` with a plain `CredentialManager` → hydrate
   profile the same way. All reads happen client-side from public endpoints;
   the viewer session is stateless and needs nothing but network access.

The ownership gate is **one string compare in the UI**
(`PreviewUI.svelte`): `client.profile?.handle == roomState.profile?.handle`
shows "Edit room" only to the owner; everyone else sees "Create room", which
switches to *their own* localStorage room and scrubs `?handle=` from the URL.
Viewing never loads someone else's roomState into your editor, so there's
nothing to tamper with — edit access is structurally separate, not
permissioned. Room's README bug list even admits the failure mode of this
pattern: no "room not found" error — a bad or moved handle fails silently.
Our gallery endpoints should 404 loudly instead.

### Mapping onto town-builder: viewers are different here

Room is a *solo* artifact; town-builder is a *shared realtime* space, so
"viewer" splits in two:

| Mode | Session | Writes | Presence |
|---|---|---|---|
| **Spectator** (shared link / gallery) | none required | none | none — static snapshot view, like room's `PreviewUI` |
| **Guest in someone's town** | kibigia JWT (already our authn) | gated by phase-4 ACL | yes, via SSE |
| **Owner** | kibigia JWT + linked DID (bridged) | full | yes |

The resulting separation:

- **In-app multiplayer stays behind kibigia auth.** `GET /events` requires the
  `auth_token` cookie today — keep it that way. Spectators get no SSE; a
  shared link renders a read-only static view (scene-description style) with
  no presence and no cursor events. This avoids any anonymous-write or
  anonymous-SSE hole.
- **The public/gallery route needs no session at all** — it reads the PDS
  record (or our cache) + renders a static scene snapshot. Same trust level as
  room's viewer: the data is public by protocol design.

### The kibigia angle: Django is the PDS-for-towns

Today kibigia *is* town-builder's room-equivalent account provider: it issues
the JWT our whole API authenticates with (auth-code exchange +
`X-TownBuilder-Secret`, or the direct `?token=` for iframe embedding), and
Django stores the town rows (`town_id`, `layout_data`, name/geo) we read back
via `load-from-django`. Verified against kibigia's source
(`~/repos/python/kibigia`):

- **JWT payload is exactly what our auth service expects**
  (`issues/views/town_builder.py:40-47`): `{user_id, username, email,
  sub: str(user.id), iat, exp +8h}` + optional `town_id`, HS256 with a
  dedicated `TOWN_BUILDER_JWT_SECRET`. No DID today.
- Exchange endpoint enforces the shared secret with constant-time compare,
  single-use 60s codes, and 20/min per-IP rate limit — the trust anchor is
  sound to extend with a `did` claim.
- **`Town` has no owner/user/membership field at all.** The ViewSet contract
  is explicit: "Any authenticated user can mutate (town-builder integration
  contract); read access is open to all" (`issues/api_views.py:207-216`).
  Ownership is greenfield on *both* sides — our Redis `town_owner` index
  would be the first ownership layer in the whole system.
- What *does* exist per-user: `UserProfile.selected_town` (which town you're
  "in"), and `create_and_select_town` (map click → find/create town → set as
  yours). So a town can exist in Django with zero town-builder involvement
  and `layout_data = NULL` — record/gallery reads must tolerate that.
- **Kibigia already runs Bluesky server-side** (`issues/utils/bluesky.py`):
  a service account (`BLUESKY_USERNAME`/`BLUESKY_PASSWORD` app password, the
  `atproto` python SDK) that searches Bluesky posts and turns them into
  `TownCategoryStatus` records. Bluesky is already kibigia's "civic truth"
  ingestion channel — user-level DID identity is the same story one level up.
- **The most important find: kibigia ships an atproto roadmap**
  (`docs/ATPROTO-SPACES.md`), and its Phase 2 already plans "ATProto OAuth /
  DID Auth" + "**Link CustomUser to DID: add `did` and `pds_url` fields to
  `accounts.CustomUser`**". Our option 1 below is not a hand-wave — it is
  upstream work already on their board. Their Phase 3/4 targets go further
  (ATProto Spaces - permissioned data for governance records,
  `org.kibigia.decision.proposal/vote/...` lexicons, per-town Space
  Authorities) — meaning towns tied to DIDs, used for access-controlled civic
  data, are the same building block they're heading toward for deliberation
  records. Our town-ownership records would be on that path, not beside it.
- **Namespace correction (against our earlier placeholder):** kibigia picked
  `org.kibigia.*` as its lexicon root in that doc. Our records should
  therefore use `org.kibigia.town` (+ `org.kibigia.town.snapshot`), not
  `org.kibigia.town`, so the governance records and town records share one
  namespace.
- **Multi-instance deployments exist** (`Town.instance_id`, docs/guides/
  multi-town-architecture.md): separate kibigia instances per town
  (`springfield.kibigia.ny.gov`) plus a state aggregator. For the record this
  means the `knot` (town-builder host) should be accompanied by an
  `instance` field (mirroring `Town.instance_id`) so one user's records can
  point at different kibigia deployments.

Structurally this is tangled's three-party split with kibigia wearing two hats:

```
kibigia/Django  ≈  user accounts + town data store (the "PDS for town data")
town-builder    ≈  realtime runtime + enforcement (the "knot"/appview)
user's atproto  ≈  decentralized ownership claims + public discovery
```

So the standing rule holds: **the record in the user's PDS is a claim;
kibigia's `town_id` stays canonical for data; town-builder's Redis
`town_owner` index is the authoritative gate, derived from verified
claims.** What this angle adds is the trust seam between two identity
namespaces in one browser session — kibigia's `username` (JWT claim) and the
atproto `did`. `/api/cursor/update` stamps `username`; ownership keys on
`did`. Bridging options, in preferred order:

1. **kibigia adds a `did` claim to its JWTs** — *already planned upstream*
   (ATPROTO-SPACES.md Phase 2). When it lands, town-builder trusts DIDs from
   the same trust anchor it uses for every authenticated request — zero new
   crypto on our side; `UserInfo.Did` (phase 0) is the receiving end. Their
   `pds_url` field on the user lets us skip the PLC resolution hop too.
2. **Claim-and-verify with no upstream changes** (ours, independent of
   upstream): the client (room-style browser OAuth) sends `ownerDid` on save
   and writes the `org.kibigia.town` record itself; the *server verifies
   out-of-band* — resolve the DID's PDS, read `org.kibigia.town/<townId>`,
   confirm `townId` + `knot` match us (tangled's verify-don't-trust, applied
   at write time). Until verified, ownership is `pending` and the town
   behaves open (phase-1); after verification, writes are owner-gated
   (phase 4). A second DID claiming an already-verified town is refused:
   first verified record wins; re-claim requires the owner's release
   (`deleteRecord`), which the server can also observe via jetstream
   (phase 5). This works today and remains correct *after* option 1 lands
   (option 1 just makes verification instantaneous at login).
3. Fallback if neither works: skip server-side enforcement; the record is
   display-only provenance for the gallery (weakest, still useful).

What stays in Django regardless: town rows, layout data, the
`townId ↔ town_id` pairing, geodata fields. The atproto record never carries
the layout (same reason tangled's PDS carries no git objects), and Django
needs no atproto knowledge to be trusted as the data store — though adopting
the DID claim (option 1/their roadmap) would let kibigia surface
"towns owned by this resident" in its own UI, which is likely a Phase-3
Space-authority requirement anyway.

Onboarding seam: kibigia's "Design Town Layout" launch
(`launch_town_builder`, the redirect view behind the town-detail button)
already enriches the redirect with `town_id` — the kibigia side can add
`?link_atproto=1` to drop the user on `/atproto/link`, a thin page running
room's `createAuthorizationUrl` dance, then POSTing the resolved DID back to
`/api/towns/link`. "Log in via kibigia → connect Bluesky → town is yours"
becomes one flow. (Note: inside iframes this must pop out to a top-level
window — see risks below.)

## Tasks

- [x] Survey flo-bit's room/roomy-worlds/atmo-*/blento, contrail, tangled.sh. *(this doc)*
- [x] tangled.sh source deep dive (`tangled.org/@tangled.org/core`: oauth, lexicons, ingester, serververify, knot2 migration). *@tangled.org/core*
- [x] kibigia source verified (`~/repos/python/kibigia`: town_builder views, Town/profile models, bluesky utils, ATPROTO-SPACES.md roadmap). *corrects NSID to `org.kibigia.*`, confirms no-ownership greenfield, confirms upstream DID-claim plan*
- [x] Draft coordination message (`docs/plans/kibigia-coordination.md` — ready to file as issue or `docs/planning/ATPROTO-TOWN-OWNERSHIP.md` upstream).
- [ ] Coordinate with kibigia upstream: `org.kibigia.*` domain ownership, `did` JWT claim timing (their Spaces Phase 2), optional `Town.owner` mirror.
- [ ] Phase 0 `setToken` wiring and did-carrying JWTs.
- [ ] Phase 1 per-town storage keys + ownership index (prereq for linking rather than global towns).
- [ ] Phase 2 client OAuth via atcute + record write on town save.
- [ ] Phase 2.5 DID bridging to kibigia (pick: `did` JWT claim upstream, or server-side claim-and-verify).
- [ ] Phase 3 (opt) indigo server-side oauth + snapshot→blob sync.
- [ ] Phase 4 (opt) server-side build ACLs (PDS record carries metadata only).
- [ ] Phase 5 (opt) jetstream-fed public gallery with ownership verification.
- [ ] Spectator mode: read-only shared-link view without SSE (no new auth surface).

## Risks / notes

- **Client metadata for OAuth must be HTTPS on the deployed domain.** `flo-bit/room`'s `src/lib/oauth/const.ts` runs `http://localhost?redirect_uri=…` loopback form in dev — mirror it, or the OAuth request fails on localhost.
- **Namespace pinned to kibigia's chosen root.** kibigia's ATProto-Spaces
  roadmap already claims `org.kibigia.*` for governance lexicons; our records
  live in the same namespace (`org.kibigia.town`, `org.kibigia.town.snapshot`)
  so one prefix covers towns + civic records. Reverse-DNS requires kibigia to
  actually own kibigia.* domain control — verify with upstream before first
  write record creation. Community namespaces
  (`community.lexicon.calendar.*`) remain a precedent if we ever want a
  type no single domain owns.
- Town record sizes: keep the `org.kibigia.town` record tiny (metadata + pointers). Full layouts live in Redis (`town_data`) & Django — never the PDS. Snapshot only.
- `{did, pds}` resolution results are cached server-side with a TTL so PDS/PLC downtime doesn't take our read endpoints down. Players who never sign in keep the localStorage save path (room does exactly this: saved locally **and/or** in your account).
- **DID vs username in claims**: today's JWTs carry only `username`/`sub` and Django-issued tokens have no DID. Phase 0's `Did` claim must come from somewhere real — either kibigia adds it, or the client passes `ownerDid` explicitly on save (client OAuth already knows it), and the server stores `town_owner:<townID>=<did>` as the index. If neither is present, towns stay unclaimed (phase 1 behavior) rather than silently assigned to `dev-user`.
- **Two identity domains in one session.** kibigia's JWT `username` and the
  atproto `did` must never be conflated: cursor/presence display keeps using
  `username`, ownership uses `did`. A JWT without a `did` claim must never be
  treated as proving (or disproving) atproto ownership.- **Anonymous access re-check before shipping phase 1.** The spectator view
  widens our public surface; make sure it reads only via the same
  public-by-design paths the gallery uses (PDS records, cached snapshots)
  and mounts no SSE and no Redis write path.
- kibigia's `?token=` direct flow is iframe-oriented: if the app is embedded,
  atproto browser OAuth redirects inside an iframe will be blocked by
  third-party-cookie rules — the `/atproto/link` page must know to open a
  popup/top-level redirect when `window.self !== window.top`.
- Confirm with kibigia/Django upstream whether `town_builder` town identity can be *canonical* by DID or pairs internally to Django's `town_id`. tangled's answer to the equivalent question was "the record rkey is the slug; the app's DB is keyed by `(user did, rkey)`" — a sane default for us is `town_owner:<townID> → did` with the Django `town_id` untouched.
- tangled's record-write rollback pattern (`appview/repo/repo.go:1440-1680`);
  knot call → PDS write (user session, CAS) → local DB write, with compensating
  cleanup at every failure point. If phase 2's save handler grows a PDS write,
  mirror that ordering: our server write is the "knot call", the client's
  `putRecord` is the "PDS announce".
- Kukicha specifics: new code goes in `internal/services/atproto/` and
  `internal/routes/atproto/` `.kuki` files (brewed `.go` committed alongside,
  per AGENTS.md); the phase-1 storage refactor edits `storage.kuki` and
  re-brews `storage.go`. indigo is an ordinary Go module import — usable from
  brewed Go directly.
