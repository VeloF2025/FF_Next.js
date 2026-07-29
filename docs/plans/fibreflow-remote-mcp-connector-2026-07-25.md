# FibreFlow Remote MCP Connector — Implementation Plan

> **For agentic workers:** work this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a FibreFlow user add `https://app.fibreflow.app/api/ff-remote-mcp/mcp` as a **custom connector** in claude.ai, authorize it with one click using their existing FibreFlow login, and then read FibreFlow **as themselves** — same RBAC, read-only, nothing more.

**Worktree:** `/home/hein/Workspace/FF_Next.js-ff-mcp`, branch `feat/ff-remote-mcp` off `origin/master`.

**Depends on:** the read-only MCP token stack, PRs [#2247](https://github.com/VelocityFibre/FF_Next.js/pull/2247)–[#2252](https://github.com/VelocityFibre/FF_Next.js/pull/2252). **Those must be merged to master before Task 4 of this plan.** This plan consumes `mintFfMcpToken`, `kind='mcp'` sessions, and the read-only gate; it does not reimplement them.

---

## Why this shape

Four decisions were settled by an adversarial planning pass on 2026-07-25. Each was verified against the running system, not assumed:

| Decision | Evidence |
|---|---|
| Python service cloned from `cortex_mcp`, not TypeScript | `FastMCP(auth_server_provider=…)` supplies the **entire** OAuth 2.1 AS — DCR, PKCE, authorize/token/refresh/revoke. Cortex's whole service is 480 lines. Hand-rolling OAuth in TS is the one part of this build where an original bug is a silent auth bypass. |
| Edge-proxied through FibreFlow | `pages/api/cortex-remote-mcp/[...path].ts` already does exactly this in production (PR #2059, `a6b912bbd`). |
| FibreFlow-hosted consent page | Cortex's consent is a paste-your-token form. FibreFlow's consent page can run *inside* the app with the user's session, so the raw token never reaches the clipboard. |
| Passthrough tools, not curated | The app has **1310 API routes**. A curated set covers a rounding error and rots. |

**Verified feasibility (2026-07-25, from velo):**
- `app.fibreflow.app` → Cloudflare (`104.21.88.79`, `172.67.174.12`), publicly resolvable.
- No Cloudflare Access — `/api/health` returns 200, no redirect to `cloudflareaccess.com`.
- `POST /api/projects` with a JSON-RPC body and no auth → **401 from FibreFlow**, not a WAF block. The transport shape is not filtered at the edge.
- `cortex-remote-mcp.service` is an **enabled systemd user unit** (not stray infra) — same convention as `gha-runner-fibreflow.service`.

## Global Constraints

- **Read-only, and not by our own promise.** The MCP service holds a `kind='mcp'` FibreFlow session. The read-only gate in `withAuth`/`requireAuth`/`withFleetAuth` refuses every mutating method server-side. The tool layer never needs to enforce this and must not pretend to.
- **The service is not a privileged actor.** It holds a per-user token and nothing else. It must never hold `JWT_SECRET`, `BRIDGE_JWT_SECRET`, a DB connection string, or a service credential. If a tool needs data the user cannot see, the answer is "no".
- **Bind localhost only.** The MCP service and its callback listen on `127.0.0.1`. The only public path is the FibreFlow edge proxy.
- **No secrets in tracked files** (CLAUDE.md rule 11). The shared callback secret lives in the deploy env file and `.claude/credentials.local.md`, never in the repo.
- **Denylist is a blast-radius guard, not a security boundary.** Say so in the code comment. RBAC + the read-only gate are the real controls.
- **Python service style:** mirror `cortex_mcp` — single module, stdlib + MCP SDK, no new framework.
- **TypeScript side:** `npm run ci:quick` clean; no `console.log`; files <300 lines, components <200.

## Out of Scope

Curated per-domain tools; write access of any kind; a second connector for Cortex data (that exists); replacing the `/cortex` token card (it stays — it serves CLI and local-stdio use).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `apps/ff_mcp/server.py` | **Create** | The MCP service: OAuth provider, consent redirect, three tools. |
| `apps/ff_mcp/pyproject.toml` | **Create** | Package metadata; entry point `ff-mcp`. |
| `apps/ff_mcp/endpoints.json` | **Create (generated)** | Route catalogue built from the file tree. |
| `scripts/build-mcp-endpoint-catalogue.ts` | **Create** | Generates `endpoints.json` from `pages/api` + `app/api`. |
| `pages/api/ff-remote-mcp/[...path].ts` | **Create** | Edge proxy. Near-verbatim from `cortex-remote-mcp`. |
| `public/.well-known/oauth-protected-resource/api/ff-remote-mcp/mcp` | **Create** | RFC 9728 resource metadata. |
| `pages/mcp/authorize.tsx` | **Create** | Consent page. Uses the existing browser session. |
| `pages/api/mcp/consent.ts` | **Create** | Mints the session, calls back to the service. |
| `deploy/ff-remote-mcp.service` | **Create** | systemd user unit. |
| `.claude/modules/ff-remote-mcp.md` | **Create** | Module reference doc. |

## Task DAG

- **PR A — Tasks 1–2**: endpoint catalogue + generator. Standalone, no runtime effect.
- **PR B — Task 3**: edge proxy + well-known metadata. Standalone; 404s until the service runs.
- **PR C — Tasks 4–5**: consent page + consent API. **Depends on the token stack being merged.** Mandatory `/review`.
- **PR D — Tasks 6–8**: the Python service. Depends on A, B, C.
- **PR E — Task 9**: systemd unit + module doc + deploy runbook.

Sequence: A ∥ B → C → D → E.

---

### Task 1: Endpoint catalogue generator

The passthrough is useless without discovery — Claude must not guess paths across 1310 routes.

**Files:** Create `scripts/build-mcp-endpoint-catalogue.ts`.

- [ ] **Step 1: Walk the route tree**

Enumerate `pages/api/**/*.ts` and `app/api/**/route.ts`, excluding `__tests__`, `_*`, and `cron/`. For each, derive the URL path (Pages: file path minus `pages/api`, `[x]` → `:x`, `index` stripped; App Router: directory path minus `app/api`).

- [ ] **Step 2: Extract methods and a description**

Methods: match `req.method === 'X'`, `case 'X'`, and App Router `export async function GET`. **Only `GET`/`HEAD` routes belong in the catalogue** — nothing else is callable with this credential, so listing them is noise that costs context.

Description: first line of the file's leading JSDoc block, trimmed to 120 chars. Absent → omit the field rather than inventing one.

- [ ] **Step 3: Emit `apps/ff_mcp/endpoints.json`**

```json
{"generatedAt":"<ISO>","routes":[{"path":"/api/projects","methods":["GET"],"group":"projects","description":"List projects…"}]}
```

- [ ] **Step 4: Verify the count is sane**

Run it. Expect several hundred GET routes across ~18 groups. **A result under 100 or over 1310 means the walker is wrong — stop and fix it, do not ship a truncated catalogue**, because a silently short catalogue makes Claude conclude an endpoint doesn't exist.

- [ ] **Step 5: Wire into the build**

Add an npm script `mcp:catalogue`. Do **not** add it to the main build — it writes into `apps/`, and a generated file changing on every build would churn the repo.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-mcp-endpoint-catalogue.ts apps/ff_mcp/endpoints.json package.json
git commit -m "feat(mcp): generate the read-route catalogue for connector discovery"
```

---

### Task 2: Denylist

- [ ] **Step 1: Define it in the catalogue generator**

```ts
/**
 * Route groups withheld from the MCP catalogue.
 *
 * This is a blast-radius guard, NOT a security boundary: anyone holding the token can
 * still curl these paths directly, and RBAC + the read-only gate remain the real
 * controls. Its job is to stop an agent wandering into payroll while answering a
 * question about drops.
 */
const DENIED_GROUPS = new Set(['accounting', 'staff', 'my']);
```

Denied routes are omitted from `endpoints.json` **and** rejected by `fibreflow_get` (Task 7) — catalogue omission alone is not enough, since Claude can construct a path it never saw listed.

- [ ] **Step 2: Test**

Assert no emitted route's `group` is in `DENIED_GROUPS`, and that the denylist actually matched something (a typo'd group name that matches nothing must fail the test, not pass silently).

- [ ] **Step 3: Commit**

---

### Task 3: Edge proxy + resource metadata

- [ ] **Step 1: Clone the Cortex proxy**

Copy `pages/api/cortex-remote-mcp/[...path].ts` → `pages/api/ff-remote-mcp/[...path].ts`. Change only the upstream default (`127.0.0.1:7416`) and the env var (`FF_REMOTE_MCP_URL`). Keep `bodyParser: false`, `responseLimit: false`, the hop-by-hop header stripping, and the dot-segment rejection **exactly as they are** — that file is in production and its path handling has been reviewed.

- [ ] **Step 2: Resource metadata**

`public/.well-known/oauth-protected-resource/api/ff-remote-mcp/mcp`:

```json
{"resource":"https://app.fibreflow.app/api/ff-remote-mcp/mcp","authorization_servers":["https://app.fibreflow.app/api/ff-remote-mcp"],"scopes_supported":["fibreflow.read"],"bearer_methods_supported":["header"]}
```

- [ ] **Step 3: Verify the proxy is inert without an upstream**

Deploy to dev. `GET /api/ff-remote-mcp/mcp` must fail closed (502/504), **not** 200. Confirm the well-known file is served: `curl https://dev.fibreflow.app/.well-known/oauth-protected-resource/api/ff-remote-mcp/mcp`.

- [ ] **Step 4: Commit**

---

### Task 4: Consent API

**Depends on PRs #2247–#2252 being merged** — it calls `mintFfMcpToken`.

**Files:** Create `pages/api/mcp/consent.ts`.

- [ ] **Step 1: Write the failing test**

Cover: rejects a missing/blank `state_id`; rejects when unauthenticated; mints with the **verified** `req.user` and never a client-supplied identity; returns 502 when the callback fails and **does not** leave a dangling session; never echoes the token in the response body.

- [ ] **Step 2: Implement**

`POST /api/mcp/consent` behind `withAuth`, body `{ stateId }`:

1. Validate `stateId` is a non-empty string of expected shape.
2. `mintFfMcpToken(req.user, '90d', { label: 'Claude connector', ipAddress, userAgent })`.
3. `POST http://127.0.0.1:7416/authorize/complete` with `{ stateId, token }` and header `X-FF-MCP-Secret: <FF_MCP_CALLBACK_SECRET>`.
4. On non-2xx: **delete the session just minted** (`deleteSession`), then 502. A token that no grant points at is a live credential nobody can see.
5. On success: return `{ redirectUrl }` from the service. **Never return the token.**

The route is `POST`, so an MCP session can never call it — the read-only gate refuses. Minting a connector requires an interactive login, by construction.

- [ ] **Step 3: Verify the failure path deletes the session**

Point the callback at a closed port. Confirm the response is 502 **and** `SELECT count(*) FROM user_sessions WHERE kind='mcp'` is unchanged.

- [ ] **Step 4: Commit**

---

### Task 5: Consent page

**Files:** Create `pages/mcp/authorize.tsx`.

- [ ] **Step 1: Build the page**

Reads `?state_id=` from the query. Renders, in plain language:

> **Allow Claude to read FibreFlow as you?**
> Claude will see the same projects, meetings and data you can see in the app — and nothing more. It cannot change anything. You can revoke this at any time from the Cortex page.

Two buttons: **Allow** → `POST /api/mcp/consent` → `window.location = redirectUrl`. **Cancel** → closes without minting.

Show the signed-in user's email so it is obvious *which* identity is being granted. If unauthenticated, `AppLayout` handles the login redirect; on return the `state_id` must survive — **verify this, it is the most likely bug in the page.**

- [ ] **Step 2: Verify with a real browser**

Playwright against dev with a real session cookie: page renders, email correct, Allow posts once (not twice on double-click), Cancel mints nothing.

- [ ] **Step 3: Commit, then `/review`**

Tasks 4–5 are the new trust boundary. Blind review, no self-review.

---

### Task 6: The service skeleton

**Files:** Create `apps/ff_mcp/{server.py,pyproject.toml}`.

- [ ] **Step 1: Copy the OAuth provider wholesale**

Take `CortexOAuthProvider` and the `FastMCP(...)` construction from `/home/hein/Workspace/Cortex/apps/cortex_mcp/server.py` verbatim. Change: store path (`~/.ff_mcp_oauth.json`), scopes (`fibreflow.read`), port (7416), public base (`FF_REMOTE_MCP_PUBLIC_BASE`).

**Do not "improve" the OAuth logic.** It is working, reviewed, in production. Changes here are how auth bypasses get introduced.

- [ ] **Step 2: Replace the consent step**

`authorize()` redirects to `https://app.fibreflow.app/mcp/authorize?state_id=<id>` instead of rendering a paste form.

Add `POST /authorize/complete`:
1. Constant-time compare `X-FF-MCP-Secret` against `FF_MCP_CALLBACK_SECRET` (`hmac.compare_digest`). Mismatch → 403, and log the attempt.
2. Look up the pending state. Missing/expired → 400. **Delete it on use** — single-use, no replay.
3. Validate the token by calling `GET /api/health` on FibreFlow with it. Rejected → 400.
4. `complete_pending(state_id, token)` → return `{"redirectUrl": …}`.

- [ ] **Step 3: Verify the secret check fails closed**

An empty or unset `FF_MCP_CALLBACK_SECRET` must make the service **refuse to start**, not accept every callback. Test it.

- [ ] **Step 4: Commit**

---

### Task 7: The tools

- [ ] **Step 1: `list_endpoints(filter?, group?)`**

Reads `endpoints.json`. Returns path + methods + description, filtered. Caps at 200 rows with a note of how many matched — a full dump is 1310 rows of context.

Description (this drives whether Claude calls it at all — be prescriptive, per the API guidance that trigger conditions in descriptions measurably lift call rate):

> "Discover FibreFlow API endpoints. Call this FIRST, before fibreflow_get, whenever you are not certain a path exists. Filter by keyword or group."

- [ ] **Step 2: `describe_endpoint(path)`**

Returns methods, description, and required path params derived from `:param` segments.

- [ ] **Step 3: `fibreflow_get(path, query?)`**

1. Reject non-`/api/` paths, `..`, and absolute URLs.
2. Reject denied groups — with the reason, so Claude stops rather than retrying variants.
3. `GET https://app.fibreflow.app<path>` with `Authorization: Bearer <session token>`.
4. **Response guard:** above ~15k characters, truncate and append an explicit note naming the `page`/`limit` params to use. Never silently truncate — Claude must know it saw a partial result.
5. **Per-request budget:** at most 40 upstream calls per OAuth token per hour. On exceed, return a clear error, not a hang. This is the guard against an agent enumerating export routes.
6. Pass through non-200 verbatim — a 403 `MCP_READ_ONLY` is *informative*, and the model should see it rather than a laundered error.

- [ ] **Step 4: Verify read-only holds end to end**

The gate is server-side, so prove it rather than trusting the tool layer: with a real connector token, `curl -X POST` the same path directly and confirm 403 `MCP_READ_ONLY`.

- [ ] **Step 5: Commit**

---

### Task 8: End-to-end on dev

- [ ] **Step 1: Run the service against dev**

`FF_REMOTE_MCP_PUBLIC_BASE=https://dev.fibreflow.app/api/ff-remote-mcp`, deploy the TS side, start the service.

- [ ] **Step 2: Verify the OAuth metadata chain**

```bash
curl https://dev.fibreflow.app/.well-known/oauth-protected-resource/api/ff-remote-mcp/mcp
curl https://dev.fibreflow.app/api/ff-remote-mcp/.well-known/oauth-authorization-server
```
Both must return valid JSON, the second with `registration_endpoint` and both grant types.

- [ ] **Step 3: Add it in claude.ai**

Add custom connector → `https://dev.fibreflow.app/api/ff-remote-mcp/mcp`, no client ID/secret (DCR). Expect: redirect to the FibreFlow consent page → Allow → back to claude.ai connected.

- [ ] **Step 4: Verify the grant is real**

```sql
SELECT label, kind, created_at, last_used_at FROM user_sessions WHERE kind='mcp';
```
One row labelled `Claude connector`. Ask Claude a question; confirm `last_used_at` populates.

- [ ] **Step 5: Verify revocation both ways**

Revoke on `/cortex` → the connector's next call fails. Re-authorize → works again.

- [ ] **Step 6: Verify scoping with a second user**

A non-owner's connector must return their `/api/meetings` count, not everyone's. This is the property that makes per-user OAuth worth building rather than a service token.

---

### Task 9: Deploy + docs

- [ ] **Step 1: systemd user unit**

`deploy/ff-remote-mcp.service`, mirroring `cortex-remote-mcp.service`. `EnvironmentFile` for the secret — **not** inline. `Restart=always`.

- [ ] **Step 2: Module doc**

`.claude/modules/ff-remote-mcp.md`: ports, env vars, the OAuth chain, how to restart, where the store lives, how to revoke.

- [ ] **Step 3: Production**

Add `FF_MCP_CALLBACK_SECRET` and `FF_REMOTE_MCP_URL` to the prod env. **After hours, with Hein's explicit approval**, via `bash scripts/deploy-local.sh production`.

- [ ] **Step 4: Commit**

---

## Definition of Done

- [ ] Connector adds in claude.ai with **no client ID/secret** (DCR works)
- [ ] Consent page shows the correct signed-in identity; Allow completes in one click
- [ ] Claude answers a question using `list_endpoints` → `fibreflow_get`
- [ ] `POST` to any route with the connector token → **403 `MCP_READ_ONLY`**
- [ ] Two users' connectors return **different** `/api/meetings` result sets
- [ ] Revoking on `/cortex` breaks the connector on its next call
- [ ] `last_used_at` populates for the connector session
- [ ] A denied group (`accounting`) is absent from the catalogue **and** refused by `fibreflow_get`
- [ ] Callback with a wrong/absent secret → 403; service refuses to start with the secret unset
- [ ] Consent failure path leaves **no** orphan session
- [ ] `npm run ci:quick` clean
- [ ] Tasks 4–5 reviewed blind via `/review`

## Rollback

The connector is additive: nothing existing depends on it. To disable, `systemctl --user stop ff-remote-mcp` — the edge proxy then fails closed and existing grants stop working with no effect on FibreFlow itself. To revoke every grant: `DELETE FROM user_sessions WHERE kind='mcp' AND label='Claude connector'`.

## Resolved exposure questions

Hein approved these decisions on 2026-07-29:

1. **Prod URL** — keep the dev connector registered while it is the test target. After
   the production connector passes a real claude.ai DCR/OAuth and live-tool smoke test,
   remove the dev registration from Claude, temporarily stop the dev MCP service to
   freeze new authorizations, and revoke its dev grants. Derive the exact session IDs
   from the frozen dev OAuth store's `ff_token` JWTs; do not use a pre-cutover database
   snapshot, which has a race, or a bulk MCP-session deletion, which would also revoke
   production grants in the shared database. The dev service may then be restarted for
   explicit engineering tests.
2. **H&S data** — keep H&S medical and incident routes available through the connector;
   do not add `health-safety` or those route prefixes to the denylist. Authorized users
   need to prompt against that data, and requests remain subject to each route's
   existing access controls plus the server-side MCP read-only gate.

### Still open: connector audience

The deployed consent page is available to every authenticated user. Hein's H&S decision
did not settle whether connector consent should be restricted to a group, so that
separate access-scope question remains open.
