# Vendored @atcute packages (Bluesky / ATProto OAuth)

Self-hosted copies of the exact versions previously loaded at runtime from
`https://esm.sh` (see the import map in `templates/index.html`). Vendored to
remove the last third-party runtime CDN dependency. All three packages are
licensed **0BSD** (Zero-Clause BSD) — copying is explicitly permitted; no
attribution required. This file records provenance anyway.

| File | Package | Version | Source (bundle URL) |
|---|---|---|---|
| `oauth-browser-client.mjs` | `@atcute/oauth-browser-client` | 5.1.0 | `https://esm.sh/@atcute/oauth-browser-client@5.1.0/es2022/oauth-browser-client.bundle.mjs` |
| `client.mjs` | `@atcute/client` | 5.1.2 | `https://esm.sh/@atcute/client@5.1.2/es2022/client.bundle.mjs` |
| `lexicons-validations.mjs` | `@atcute/lexicons` | 2.1.1 | `https://esm.sh/@atcute/lexicons@2.1.1/es2022/validations.bundle.mjs` |

`client.mjs` was patched in one place: its single import of
`/@atcute/lexicons@^2.1.0/validations?target=es2022` (esm.sh absolute URL form)
was rewritten to the relative `./lexicons-validations.mjs`. No other changes.
The other two files are byte-identical to the published bundles.

Resolved versions are exact, as pinned by the previous import map entries
(`@5.1.2`, `@5.1.0`) plus the transitive dependency esm.sh resolved for
`^2.1.0` (2.1.1). To upgrade: fetch the `?bundle` builds for the new versions
from esm.sh, apply the same one-line import rewrite, and update this file.
