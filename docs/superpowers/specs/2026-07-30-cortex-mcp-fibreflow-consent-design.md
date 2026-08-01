# Cortex MCP FibreFlow Consent and AI Connections — Design

**Date:** 2026-07-30
**Status:** Approved design; ready for implementation planning
**FibreFlow branch:** `feat/cortex-mcp-ff-consent`
**Repositories:** `FF_Next.js` and `Cortex`

## 1. Problem

FibreFlow currently presents two different connector experiences on `/cortex`:

- FibreFlow Remote MCP has the correct browser flow: Claude redirects to FibreFlow,
  the user signs in and consents, and FibreFlow grants read-only access as that user.
- Cortex Remote MCP redirects to a Cortex-hosted form that asks the user to generate
  and paste a bearer token. The same page also emits a local `uv` configuration with
  the literal `/path/to/Cortex`, which is not a usable general-user setup.

The valid remote endpoint is
`https://app.fibreflow.app/api/cortex-remote-mcp/mcp`; the missing piece is a login-backed authorization handoff, not another local runtime or Cerebro.

Lew, the Velocity Fibre MD (`lew@velocityfibre.co.za`), must be able to authorize the
connector and retrieve the full tenant. “Executive access” means full-tenant **read**
scope; it does not add mutating MCP tools.

## 2. Goals

1. Give Cortex Remote MCP the same sign-in-and-consent experience as FibreFlow MCP.
2. Derive identity only from the verified FibreFlow session.
3. Grant Lew full Velocity Fibre tenant retrieval while ordinary users remain
   membership/ACL-scoped.
4. Separate connector setup from Cortex search and review in the FibreFlow UI.
5. Keep the working FibreFlow Remote MCP flow and its RBAC/read-only behavior intact.
6. Preserve marked-compatible Cortex OAuth grants and retain a temporary rollback
   route; unsafe unmarked grants fail closed and require re-consent.

## 3. Non-goals

- No Cerebro dependency. Cerebro may remain a consumer, but it is not an auth layer.
- No `client_credentials` or headless service identity; a person signs in and consents.
- No Cortex write, approve, ingest, or administration tools through MCP.
- No OAuth-store schema migration and no database schema migration.
- No token-rotation incident work. Credential values must not appear in code, docs,
  URLs, browser responses or logs.
- No production deployment without Hein's explicit approval and after-hours gate.

## 4. Connector and access model

| Connector | Purpose | Identity and authorization |
|---|---|---|
| FibreFlow Operations | Projects, QField, fleet, procurement and other FF APIs | Verified FF user; existing FF RBAC plus server-enforced read-only MCP session |
| Cortex Knowledge | Meetings, email, WhatsApp, SharePoint, timelines and cited evidence | Verified FF email; Cortex tenant gate plus channel membership, with a server allowlist for tenant-bound full read |

The connectors deliberately remain separate OAuth authorization servers and use
separate callback secrets. A flaw or secret rotation in one connector must not grant
access to the other.

## 5. Approved authorization flow

```text
Claude custom connector
  -> /api/cortex-remote-mcp/authorize
  -> Cortex records a 10-minute pending OAuth request
  -> /cortex/mcp/authorize?state_id=... on FibreFlow
  -> FF sign-in, preserving the complete return URL
  -> signed-in user reviews and clicks Allow
  -> POST /api/cortex/mcp-consent { stateId }
  -> FF verifies cortex.review:view and mints a 90-day Cortex JWT
     for req.user.email
  -> FF POSTs { stateId, token } over loopback to
     Cortex /authorize/complete with X-Cortex-MCP-Secret
  -> Cortex requires exact token_use="mcp", then validates secret, state and the
     unchanged bearer against the Bridge
  -> Cortex consumes the pending request and returns redirectUrl
  -> browser returns to Claude with the authorization code
  -> Claude exchanges the code and receives access + refresh tokens
```

The Cortex bearer travels only on the server-to-server loopback request. It is never
returned by the FibreFlow API, placed in a redirect URL, rendered in HTML, or logged.
The outer Cortex OAuth refresh grant expires after 30 days and then requires a new
browser authorization. That 30-day reauthorization boundary still applies even
though FibreFlow minted the underlying normal Cortex bearer with a 90-day claim.

## 6. FibreFlow changes

### 6.1 Dedicated consent page

Add `pages/cortex/mcp/authorize.tsx`, following the proven behavior of
`pages/mcp/authorize.tsx`:

- Standalone consent screen, not the full app shell.
- Wait for router and auth hydration before evaluating `state_id`.
- Unauthenticated users go to `/sign-in?returnUrl=...`, preserving the state.
- Missing state fails with a user-readable message.
- Double submission is synchronously blocked.
- Allow posts only `{ stateId }`; no email, role, token or redirect is accepted from
  the browser.
- Cancel is terminal and does not mint anything.

Use a Cortex-specific consent card so the page clearly describes knowledge access,
full/limited scope, read-only behavior and the exact signed-in email.

### 6.2 Dedicated consent API

Add `POST /api/cortex/mcp-consent`, modeled on `pages/api/mcp/consent.ts` but kept
separate from the FibreFlow connector:

- Wrap with `withAuth`, then `withPermission('cortex.review', 'view')`.
- Accept only a `stateId` matching the existing 16–128 character base64url shape.
- Read identity only from `req.user.email`.
- Call `mintMcpToken(req.user.email, '90d')`.
- Require `CORTEX_MCP_CALLBACK_SECRET`; fail before minting if it is absent.
- POST to `${CORTEX_REMOTE_MCP_URL}/authorize/complete`, defaulting to loopback:7414.
- Send the secret in `X-Cortex-MCP-Secret`.
- Treat timeout, non-2xx, invalid JSON and unsafe redirects as failed authorization.
- Return only `{ redirectUrl }` through `apiResponse.success`.
- Log user/session-safe identifiers and statuses only, never the bearer or secret.

Unlike FibreFlow MCP sessions, the Cortex JWT is not written to the FibreFlow session
table. A callback failure leaves no discoverable OAuth grant. The token remains in
process memory/the failed loopback request and must not be echoed with the error.

### 6.3 Configuration

| Variable | Owner | Purpose |
|---|---|---|
| `CORTEX_REMOTE_MCP_URL` | FibreFlow server | Existing loopback upstream; reused by consent callback |
| `CORTEX_MCP_CALLBACK_SECRET` | FF and Cortex servers | Dedicated callback authentication; never tracked |
| `BRIDGE_JWT_SECRET` and optional `BRIDGE_JWT_KID` | FibreFlow/Cortex Bridge | Existing signing and verification contract |
| `CORTEX_INSTANCE_ID` | FibreFlow | Existing tenant claim, `velocity-fibre` in deployment |

The callback secret is stored only in the relevant server environment files. It is
not the existing `FF_MCP_CALLBACK_SECRET`.

Before activation, operators compare non-reversible hashes of the callback secret
loaded by FibreFlow and Remote MCP: those hashes must be equal. A separate hash
comparison against `FF_MCP_CALLBACK_SECRET` must be unequal. They also require hash
agreement for FibreFlow's and Bridge's loaded `BRIDGE_JWT_SECRET`, and exact
`BRIDGE_JWT_KID` agreement when a kid is configured. Only verdicts are recorded;
underlying values are never printed.

## 7. Cortex changes

Refactor remote-only OAuth code from `apps/cortex_mcp/server.py` as needed to keep new
Python files below the repository size limit.

1. Add `CORTEX_FF_APP_BASE`, defaulting to the FibreFlow production origin.
2. In `CortexOAuthProvider.authorize()`, keep the existing pending request but redirect to
   `${CORTEX_FF_APP_BASE}/cortex/mcp/authorize?state_id=<encoded-id>`.
3. Add `peek_pending()` so validation failures do not consume a retryable state.
4. Add `POST /authorize/complete`:
   - compare `X-Cortex-MCP-Secret` with `CORTEX_MCP_CALLBACK_SECRET` using
     constant-time byte comparison;
   - reject missing/invalid JSON, state or token;
   - reject unknown, expired and replayed states;
   - validate the bearer against Bridge `/api/query` on a worker thread;
   - consume the state only after successful validation;
   - return only a safe HTTP(S) `redirectUrl`.
5. In `streamable-http` mode, refuse startup if the callback secret is absent.
   Stdio mode remains importable without this remote-only configuration.
6. Keep `/authorize/approve` temporarily as an unlinked operator rollback path.
   The normal authorization redirect must never point to it.
7. Preserve the OAuth store models and token prefixes. Existing authorization-code,
   access and refresh grants continue only when their embedded Cortex bearer has an
   exact `token_use="mcp"` marker. Unsafe unmarked credentials fail closed, their
   affected grant rows are invalidated or consumed when presented, and the user must
   re-consent. The marker is only an unverified shape precondition; Bridge remains the
   signature, tenant, identity, expiry, membership and revocation authority.

OAuth metadata remains authorization-code plus refresh-token only. Adding
`client_credentials` would change the human identity/audit model and is out of scope.

## 8. Lew's tenant scope

The Bridge reads `CORTEX_SUPER_ADMIN_EMAILS` at module import. This design is not
evidence of the current live allowlist or deployment state; operators must read back
the effective configuration at the approved rollout gate.

During controlled rollout:

1. Verify Lew's FibreFlow account and `cortex.review:view` permission.
2. If absent, grant it through the supported FF RBAC path authorized by the owner.
3. Add `lew@velocityfibre.co.za` to `CORTEX_SUPER_ADMIN_EMAILS`, preserving every
   existing entry, then independently read back the complete effective set and abort
   if Lew is absent or any prior entry was dropped.
4. Activate Cortex Agent Executor first, then Cortex Bridge, then Cortex Remote MCP,
   and FibreFlow last.
5. Prove Lew receives tenant-bound full reads, including meeting detail and minutes
   packs, while an ordinary user remains ACL-limited.

Because the Bridge resolves the email in the embedded bearer on each request, adding
Lew to the allowlist also widens a marked-compatible existing Lew OAuth grant after
the Bridge restart; the user does not need a new personal token for that compatible
grant. Unsafe unmarked authorization codes, access tokens and refresh tokens fail
closed and require re-consent; rollout must not try to prove that one continues.
Reconnecting is still used to prove the new browser flow end to end.

The allowlist creates a distinct tenant-bound read capability for Lew and every
other configured `CORTEX_SUPER_ADMIN_EMAILS` entry. It includes meeting detail and
minutes-pack reads, including restricted meetings inside the verified tenant, but
does not make the caller a meeting admin. Do not add Lew to
`CORTEX_MEETING_ADMIN_EMAILS` as a shortcut: full-tenant read must not enable
classify, legal-hold, process, intake, action, delivery or any other write path.

## 9. FibreFlow UI: AI Connections module

Connector setup moves out of `/cortex`.

### `/connections/fibreflow`

- Heading: **FibreFlow Operations**
- Explain projects, QField, fleet, procurement and existing FF RBAC.
- Show the remote connector URL and Claude “Add custom connector” instructions.
- Show the signed-in user's active MCP sessions and per-session revoke controls.
- Put manual bearer-token minting behind a collapsed **Advanced** section.

### `/connections/cortex`

- Heading: **Cortex Knowledge**
- Explain meetings, email, WhatsApp, SharePoint, timelines and cited evidence.
- Show `https://app.fibreflow.app/api/cortex-remote-mcp/mcp` and the Claude setup steps.
- Explain that Claude opens FF sign-in/consent and uses the signed-in user's access.
- Do not render a token, local `uv` command, package claim, `/path/to/Cortex`, or
  copied stdio configuration in the primary flow.
- Gate the page and CTA with `cortex.review:view`.

Add `src/components/connections/ConnectionsNav.tsx`, backed by the existing
`ModuleNav`, with horizontal **FibreFlow** and **Cortex** tabs. Add `/connections` as
a server-side redirect to `/connections/fibreflow`. Add one **AI Connections**
sidebar entry while retaining the existing Cortex knowledge entry.

`/cortex` keeps the premium hero, cited search and review queue. Remove both connector
panels from that page and add a small link to `/connections/cortex`.

The existing manual Cortex mint/revoke API may remain during the rollback period, but
its broken local configuration must not be exposed as the normal user workflow.

## 10. Security and failure invariants

- Browser-supplied email, role, token, callback URL and redirect URL are ignored.
- Both authentication and `cortex.review:view` are enforced server-side.
- State is short-lived, shape-checked, single-use and consumed only after validation.
- Callback authentication is connector-specific and constant-time.
- The remote service remains bound to loopback; the public proxy remains the sole
  internet-facing MCP path.
- Missing secrets, unavailable upstreams, malformed bodies and unsafe redirects fail
  closed.
- Tokens and secrets never appear in logs, client responses, URLs or tracked files.
- Existing FF MCP authorization, endpoint catalogue, RBAC and read-only enforcement
  are not modified.
- Full-tenant Lew scope is still tenant-bound to `velocity-fibre`.
- Marked-compatible outer OAuth grants remain usable. Unsafe unmarked authorization
  codes, access tokens and refresh tokens fail closed and require re-consent; neither
  rollout nor rollback may preserve or re-enable them.

## 11. Verification

Implementation is test-driven.

### FibreFlow tests

- State survives the unauthenticated sign-in round trip.
- Missing state and duplicate Allow actions fail safely.
- The consent API is POST-only and rejects malformed state.
- Unauthenticated and permission-denied callers cannot authorize.
- A forged browser email is ignored; mint receives the verified session email.
- Missing callback secret prevents minting.
- Callback request uses loopback, the dedicated header and a finite timeout.
- Callback failures and unsafe redirects return no token and no success response.
- Successful response contains only `redirectUrl`.
- Existing FibreFlow MCP consent and proxy suites remain green.
- Verify `/connections/*`, navigation, permissions and responsive layout with
  component tests and desktop/mobile Playwright.
- Run the focused Vitest suites, `npm run ci:quick`, and the relevant production build.

### Cortex tests

- Authorization redirects to the correct FF host and preserves encoded state.
- Remote startup fails without the dedicated secret; stdio import remains valid.
- Callback rejects bad secrets, malformed bodies, expired/unknown/replayed state and
  rejected bearer tokens.
- Bearer validation failure does not consume pending state.
- Successful callback creates one code, consumes state and returns no bearer.
- Marked-compatible code exchange, refresh, revocation, MCP tool and read-only tests
  stay green; unsafe unmarked code/access/refresh fixtures fail closed and persist
  their narrowly scoped invalidation.
- Super-admin tests include Lew as full scope and an ordinary user as ACL-limited.

### Live proof on dev

1. Start an isolated executor on `127.0.0.1:17406`, then an isolated Bridge on
   `127.0.0.1:17403` with `EXECUTOR_URL=http://127.0.0.1:17406`, then isolated Remote
   MCP on `127.0.0.1:17414`. Use a unique OAuth store and the dev public base; the
   isolated Bridge must never call production executor port `7406`.
2. Connect both custom connector URLs from a real Claude client.
3. Complete Cortex authorization through FibreFlow login and consent without copying
   a token.
4. Run cited Cortex queries as Lew and as an ordinary user; compare scope.
5. Run FibreFlow project/QField queries and confirm its RBAC behavior is unchanged.
6. Exercise revoke/disconnect and reconnect.
7. Capture desktop and mobile screenshots of both connection pages.

## 12. Delivery and rollback

Use two coordinated PRs:

1. **Cortex PR:** consent redirect/callback, fail-closed configuration and tests.
2. **FibreFlow PR:** consent page/API, AI Connections UI and regression tests.

Deploy in one direction only: Cortex Agent Executor, then Cortex Bridge, then Cortex
Remote MCP, then FibreFlow. Configure secrets through untracked environment files and complete the
isolated live proof described above. Because the current remote service is
production-facing, real dev OAuth must use isolated executor/Bridge/Remote processes,
a unique store, and a dev public base; do not repoint its live authorization flow at
dev. Production promotion uses each repository's supported procedure, only after
hours and with Hein's explicit approval.

Rollback order:

1. Reverse exposure first by reverting/hiding the FibreFlow consent/proxy and
   connection pages.
2. Restore Cortex's authorization redirect to the retained `/authorize/approve` and
   roll back Remote MCP without removing the marker gate or unsafe-grant invalidation.
3. Roll back Bridge read-scope behavior only if required. Remove Lew from the
   super-admin allowlist only if the access decision itself is being rolled back;
   preserve and read back all unrelated entries.
4. Roll back Agent Executor last if required.
5. Keep the working FibreFlow connector and marked-compatible Cortex OAuth grants
   usable. Never restore, preserve or require proof of an unsafe unmarked grant;
   affected users re-consent after rollback through the retained safe flow.

## 13. Acceptance criteria

- Lew can add Cortex using the published remote MCP URL, sign in to FibreFlow, consent,
  and query the full Velocity Fibre Cortex tenant without copying a token.
- A normal employee follows the same flow but receives only their Cortex ACL scope.
- FibreFlow MCP continues to authenticate and enforce FF RBAC exactly as before.
- `/cortex` is a knowledge/review page; `/connections/*` is the connector setup area.
- No primary UI contains `/path/to/Cortex` or a local-runtime requirement.
- All focused tests, `npm run ci:quick`, build and real dev-browser/Claude checks pass
  before any production deployment is proposed.
