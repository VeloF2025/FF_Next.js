# FibreFlow Remote MCP connector

Lets a FibreFlow user add FibreFlow to claude.ai as a **custom connector** and read it
**as themselves** — same RBAC, read-only, nothing more.

Connector URL: `https://app.fibreflow.app/api/ff-remote-mcp/mcp`
(dev: `https://dev.fibreflow.app/api/ff-remote-mcp/mcp`)

## Approved exposure policy

Hein approved this policy on 2026-07-29:

- Keep the dev connector registered while it is the test target. After the production
  connector passes a real claude.ai DCR/OAuth and live-tool smoke test, remove the dev
  registration from Claude, temporarily stop the dev MCP service to freeze new
  authorizations, and revoke its dev grants. Derive the exact session IDs from the
  frozen dev OAuth store's `ff_token` JWTs; do not use a pre-cutover database snapshot,
  which has a race, or a bulk `kind='mcp'` deletion, which would also revoke production
  grants in the shared database. The dev service may then be restarted as an explicit
  engineering test surface.
- Keep H&S routes, including medical and incident routes, available through the
  connector. Do not add `health-safety` or those route prefixes to `DENIED_GROUPS`.
  This is intentional so authorized users can prompt against H&S data; each request
  still runs as that user through the route's existing access controls and the
  server-side MCP read-only gate.

This approval did not decide whether connector consent should be restricted to a group.
The deployed page remains available to every authenticated user until Hein decides that
separate access-scope question.

## Shape

```
claude.ai ──► app.fibreflow.app/api/ff-remote-mcp/*   (edge proxy, unauthenticated)
                        │
                        ▼
              127.0.0.1:7416  ff_mcp        (OAuth 2.1 AS + 7 tools, localhost only)
                        │  authorize() redirects to ↓
                        ▼
              app.fibreflow.app/mcp/authorize?state_id=…   (consent page, user's session)
                        │  Allow ⇒ POST /api/mcp/consent
                        ▼
     /api/mcp/consent: mintFfMcpToken() mints the token locally
                (no network), then POSTs it to
                127.0.0.1:7416/authorize/complete
                        │  (X-FF-MCP-Secret)
                        ▼
              redirectUrl back to claude.ai — connected
```

The service is **not** a privileged actor: it holds a per-user token and the callback
secret, and nothing else. No `JWT_SECRET`, no DB connection, no service credential.

## Files

| Path | Role |
|---|---|
| `apps/ff_mcp/config.py` | Settings + the startup secret guard |
| `apps/ff_mcp/oauth.py` | OAuth 2.1 provider (copied from Cortex's `cortex_mcp`) |
| `apps/ff_mcp/server.py` | HTTP surface: `/authorize/complete`, metadata, `/help` |
| `apps/ff_mcp/catalogue.py` | `list_endpoints`, `describe_endpoint` |
| `apps/ff_mcp/tools.py` | `fibreflow_get` + `_guard_path`, the guard every tool shares |
| `apps/ff_mcp/photo_tools.py` | `view_photo` — image content, not text |
| `apps/ff_mcp/photo_search_tools.py` | `find_project_photos`, `get_photo_download_manifest` |
| `src/lib/photos/photoQuery.ts` | One filter grammar over both photo corpora |
| `src/lib/photos/photoLinks.ts` | HMAC signing for download links |
| `pages/api/photos/{search,manifest,download}.ts` | Query, download plan, and bytes |
| `apps/ff_mcp/endpoints.json` | Generated catalogue (`npm run mcp:catalogue`) |
| `pages/api/ff-remote-mcp/[...path].ts` | Edge proxy — the only public path |
| `pages/api/mcp/consent.ts` | Mints the token, calls the service back |
| `pages/mcp/authorize.tsx` | The consent screen |
| `deployment/systemd/ff-remote-mcp.service` | The unit |

## Ports and env

| Var | Meaning |
|---|---|
| `FF_REMOTE_MCP_PORT` | 7416 (localhost only) |
| `FF_APP_BASE` | `https://dev.fibreflow.app` or `https://app.fibreflow.app` |
| `FF_REMOTE_MCP_PUBLIC_BASE` | `<FF_APP_BASE>/api/ff-remote-mcp` |
| `FF_REMOTE_MCP_STORE` | `~/.local/state/ff-remote-mcp/oauth.json` — systemd's `StateDirectory` creates it 0700 |
| `FF_MCP_CALLBACK_SECRET` | Shared with `/api/mcp/consent`. **Never in a tracked file** |
| `FF_REMOTE_MCP_URL` | Read by the *edge proxy*: upstream, default `http://127.0.0.1:7416` |
| `PHOTO_LINK_SECRET` | Signs photo download links. **Unset = downloads refuse, by design** |
| `VLM_PROXY_SECRET` | Already required by works-qa zips; `/api/photos/download` needs it too |

Secrets live in `~/.ff-remote-mcp.env` (chmod 600, untracked) and
`.claude/credentials.local.md`.

**One instance per host.** dev and production run under the same OS user, so the port
(7416) and the OAuth store are shared state. Running a second environment means
overriding `FF_REMOTE_MCP_PORT`, `StateDirectory`, and `EnvironmentFile` in a drop-in —
and repointing that environment's `FF_REMOTE_MCP_URL` — not just `WorkingDirectory`.
Two processes doing write-tmp-then-rename against one `oauth.json` destroy each other's
grants.

## Operating it

> **Do not enable the unit until `apps/ff_mcp/` is on master.** The unit runs
> `python3 -m ff_mcp`; if the Python service is not deployed, `ExecStart` fails
> immediately and `Restart=always` crash-loops it until `StartLimitBurst=5` trips it
> into a permanently failed state needing `systemctl --user reset-failed`. Check first:
> `ls /home/velo/fibreflow-dev/apps/ff_mcp/server.py`.

```bash
systemctl --user status ff-remote-mcp
systemctl --user restart ff-remote-mcp
journalctl --user -u ff-remote-mcp -f

# Metadata chain (RFC 9728 → RFC 8414):
curl -s https://dev.fibreflow.app/.well-known/oauth-protected-resource/api/ff-remote-mcp/mcp | jq
curl -s https://dev.fibreflow.app/api/ff-remote-mcp/.well-known/oauth-authorization-server | jq
```

## Revoking

Per user, from the **Cortex page** token list, or directly:

```sql
-- one user's connector
DELETE FROM user_sessions WHERE kind='mcp' AND label='Claude connector' AND user_id=$1;
-- every connector grant
DELETE FROM user_sessions WHERE kind='mcp' AND label='Claude connector';
```

Revocation is immediate: both auth wrappers resolve the session row on every request
and 401 when it is gone. The service's own OAuth store still holds an access token, but
it is now useless.

To disable the connector entirely: `systemctl --user stop ff-remote-mcp` — the edge
proxy then fails closed (502) and FibreFlow itself is unaffected.

## Gotchas

- **`/api/health` cannot validate a token.** It is unauthenticated and 200s for any
  `Authorization` header. Token validation uses `GET /api/auth/me`, which is behind
  `withAuth`. Do not "simplify" this back.
- **Cortex's `_HTTPS` is `"http://s"`** — it derives it as `_HTTP + "s"`. Do not copy
  that idiom across; `config.py` builds the prefix independently.
- **The consent redirect must target `FF_APP_BASE`, not the proxy base.** The user's
  session cookie is on the app host. A dev service pointed at the prod base would send
  users to prod to authorize a dev connector.
- **The three photo tools do different jobs and must not be substituted.**
  `find_project_photos` returns metadata a page at a time, `view_photo` returns ONE photo
  as an image, `get_photo_download_manifest` returns a link that yields every match. The
  tool descriptions are what route the model between them — they are load-bearing.
- **A download manifest is uncapped, deliberately** (decision: Hein, 2026-08-12 — existing
  RBAC, no ceiling). One filter can therefore be ~79 GB. Every mint is logged with the
  user id, match count and filter, so a large egress stays attributable.
- **Minting a manifest needs `construction-qa.export`, not `construction-qa.qa-centre`.**
  The module already splits view from export — `/api/construction-qa/export` and both
  works-qa zips gate on an `.export` key, and the RBAC seed grants `qa-centre` to at
  least one role it does not grant `export` to. `/api/photos/search` (metadata only)
  keeps `qa-centre`; the uncapped bulk export does not.
- **A child link may never outlive its parent.** `serveSignedManifest` signs download
  links with `remainingTtl(manifest.exp)`, not a fresh hour. Minting full-TTL children
  would make the real window 2x the advertised one — fetch the manifest at T+59m, hold
  working downloads until T+119m — and the ceiling would stop being a ceiling.
- **Every signed link carries a `purpose`, enforced by a throw.** The two link classes
  are otherwise distinguished only by having disjoint field names, which is an accident,
  not a property: a third class reusing `key`/`uid` would be substitutable for a download
  link with no test failing.
- **Never buffer a photo to send it.** `/api/photos/download` pipes. The earlier
  buffering implementation in this same subsystem drove the production heap past 12 GB
  and caused multi-hundred-millisecond GC pauses across every route — see the header of
  `src/lib/construction-qa/minioPhotoStream.ts`, which was rewritten to stream for
  exactly this reason. This route serves a sandbox pulling thousands of images at once.
- **Both signature-only branches are rate-limited** (`rateLimiter`, keyed on the minting
  user). They are unauthenticated by design, and a manifest fetch re-runs an uncapped
  query plus one HMAC per row, so one leaked URL would otherwise be an hour of unmetered
  full-corpus scans.
- **`rateLimiter` is a DEFAULT export.** `import { rateLimiter }` type-checks against the
  module's other exports and is `undefined` at runtime — every request then throws on
  `.check`.
- **`/api/photos/download` authenticates on a SIGNATURE, not a session.** The downloader
  is Claude's Cowork sandbox, which holds no FibreFlow cookie and cannot be given one.
  RBAC is evaluated once, when the manifest is minted for an authenticated user; the
  signed link carries that decision for an hour, bound to one photo key so a leaked link
  cannot be walked into the rest of the archive.
- **`qfield_photo_validations.project_id` is NULL on all 60,875 rows.** The project is
  recoverable only from the key path (`projects/<qfieldcloud-uuid>/...`) via
  `qfield_projects` → `qfield_project_links`. Filtering that table on its own
  `project_id` column returns zero rows, always, and looks like "no photos" rather than
  a bug.
- **`qfield_photo_validations` has no capture time.** Its only timestamp is
  `validated_at` — when validation RAN, which can be months after the photo was taken.
  It is surfaced under `captured_at` for the union but tagged `date_basis='validated'`,
  and callers must say so when a date-filtered answer includes QField rows. Treating the
  two as one column silently answers "photos from August" with June photos.
- **Cross-corpus duplicates resolve by `corpus_rank`, never by timestamp.** ~102 keys
  exist in both corpora; a time-ordered tiebreak hands every one to the QField row,
  because validation always postdates capture — and that row carries no
  `file_size_bytes`, `vlm_valid`, `zone_no`, `pon_no` or `filename`.
- **A filter a corpus cannot answer must return NOTHING from it, not an approximation.**
  QField has no VLM verdict column, so `vlm` excludes that corpus rather than
  substituting `needs_retake`; zone/PON do the same. Substituting also produced
  `vlm='fail'` + `needsRetake=false` → `IS TRUE AND IS NOT TRUE`, silently always empty.
- **The abort timer on `/api/photos/download` must be disarmed the moment the fetch
  resolves.** Aborting the controller after that kills the in-flight body, so a timer
  left armed across the transfer truncates any download slower than it — 8.9 MB in 30s
  needs a sustained 300 KB/s, which concurrent bulk pulls will not hold, and for
  `source=qfield` upstream sends no `Content-Length` so nothing downstream detects the cut.
- **After piping starts, `res.headersSent` is not enough.** When the source fails before
  the first byte, `stream/promises` pipeline destroys the destination with
  `headersSent === false` — so a 500 written on that path does not throw and is silently
  swallowed by a dead socket. Check `headersSent || destroyed || writableEnded`.
- **`file_size_bytes` is NULL on ~82% of QA photos and absent from QField entirely.**
  Summing it alone reports 0 MB for a 10,980-photo download. Report the unsized count
  alongside any total, and label the extrapolation an estimate.
- **Vitest needs an explicit alias for anything under `src/lib`.** `@/lib` falls back to
  `./lib`, so `@/lib/photos` resolves to nothing without its own entry in
  `vitest.config.ts`. The failure is at import time and reads as "does the file exist?".
- **`fibreflow_get` cannot return a photo, and never will.** It decodes every response
  as UTF-8 and caps it at `MAX_RESPONSE_CHARS`, so a 150 KB JPEG arrives as 15,000
  characters of mojibake with its SOI marker already replaced — measured, not theorised.
  Photos go through `view_photo`, which returns MCP image content. Both reach FibreFlow
  through the same `_guard_path`, so the denylist and traversal checks apply to both;
  a second fetch path with its own copy of the guard is how a denylist silently rots.
- **Do not re-encode a photo that is already small enough.** QField photos arrive at
  1600px, already compressed harder than `JPEG_QUALITY`. Re-encoding one measured
  388 KB → 623 KB: more bytes and a second generation of artefacts, to shave 32 pixels
  Claude's own resampler would have taken off. `PASSTHROUGH_SLACK` is why photos within
  1.25× of the ceiling are forwarded untouched.
- **The denylist is a blast-radius guard, not a security boundary.** RBAC and the
  read-only gate are the real controls. It is mirrored in two places —
  `scripts/build-mcp-endpoint-catalogue.ts` (`DENIED_GROUPS`) and `apps/ff_mcp/tools.py`
  — because catalogue omission alone does not stop a model constructing a path it never
  saw listed. Change both.
- **`WorkingDirectory` is the deploy dir**, not a workspace checkout. A workspace tree
  follows whatever branch is checked out and can sit frozen behind origin.
- **Read-only is enforced server-side**, in `withAuth`/`requireAuth`. The tool layer
  does not enforce it and must not pretend to.
- **Cloudflare 403s the default Python User-Agent.** Both `*.fibreflow.app` hosts sit
  behind Cloudflare, which answers `Error 1010 browser_signature_banned` to
  `Python-urllib/*`. Measured on dev: `Python-urllib/3.12` → **403**, while
  `ff-remote-mcp/0.1` and `ff-remote-mcp-oauth/0.1` → **200**. The explicit `User-Agent`
  headers in `tools.py`, `photo_tools.py` and `server.py` are therefore load-bearing, not decoration —
  strip them and every tool call and token validation starts failing with an HTML error
  page. Any script written against these endpoints needs one too.
- **The path guards run on a canonical path** — unquoted until stable, then lower-cased.
  Next.js decodes percent-escapes before routing and its route dirs are lower-case, so
  checking the raw string let `/api/Accounting/ledger` and `/api/%2e%2e/x` straight past.
- **`x-forwarded-host` is attacker-controlled here.** The nginx configs in `docs/VPS/`
  set `Host`, `X-Real-IP`, `X-Forwarded-For` and `X-Forwarded-Proto` — never
  `X-Forwarded-Host` — so it passes through from any caller.
  `pages/api/mcp/resource-metadata.ts` therefore resolves against an allow-list and
  answers `Cache-Control: no-store`; do not "simplify" it back to echoing the header.

## Tests

```bash
FF_MCP_CALLBACK_SECRET=test-secret python3 -m pytest apps/ff_mcp/ -q
npx vitest run pages/api/mcp/__tests__ tests/pages/mcp-authorize.test.tsx \
              tests/api/mcp-resource-metadata.test.ts tests/api/ff-remote-mcp-proxy.test.ts
```

Pass vitest the **test file or its directory**, not the source directory: `vitest run
pages/api/mcp` matches no `*.test.ts` and exits 1, which reads as a failure.

Related: `docs/plans/fibreflow-remote-mcp-connector-2026-07-25.md` (the plan),
`pages/api/cortex-remote-mcp/[...path].ts` (the sibling proxy this one was cloned from),
and the Cortex service itself at `Cortex/apps/cortex_mcp/server.py` in the Cortex repo —
there is no `.claude/modules/` doc for it.
