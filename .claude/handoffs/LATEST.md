> ## ⚠️ Read this first — the body below is dated 2026-07-29 12:45 and its live-state claims have moved
>
> Re-verified 2026-07-30 10:40 SAST. The lessons and defect write-ups below remain valid;
> these four statements about the running system do not.
>
> | The body says | Verified now |
> |---|---|
> | "**Production is untouched**" | **False.** `ff-remote-mcp-production.service` is **active**, `ActiveEnterTimestamp` 2026-07-30 03:59:23 SAST. Prod `.env.local` carries both `FF_MCP_CALLBACK_SECRET` and `FF_REMOTE_MCP_URL`, and `apps/ff_mcp/` + `pages/api/ff-remote-mcp/[...path].ts` are deployed. The connector is **live in production**. |
> | "1 intentional: `python3 -m ff_mcp` (PID `3640487`) — do not kill it" | **PID 3640487 no longer exists.** The real process is **PID 3148**, in cgroup `ff-remote-mcp-production.service`. The *dev* unit `ff-remote-mcp` is **inactive**. |
> | "Dev runs `d96d677e8`; master is `865c2e75c`" | master `e49b84bb8`, production `e49b84bb8`, dev `41fe36b29`. |
> | "Worktrees: 25 open" | 7. |
>
> **Do not act on a pinned PID from any handoff.** Resolve the process from its unit
> instead — `systemctl --user status ff-remote-mcp-production` — because a recycled PID
> makes "do not kill 3640487" point at an unrelated process while leaving the real
> production service looking unaccounted for.
>
> Before trusting any SHA, count, or process fact below, re-check it:
> `git fetch origin && git log origin/master --oneline -5`

# Handoff — 2026-07-29 12:45 SAST

**Project:** FF_Next.js (FibreFlow)
**Branch:** `docs/handoff-mcp-connector` (off `origin/master` @ `865c2e75c`, clean)
**Session goal:** Ship Remote MCP connector plan Tasks 4–9 — consent API, consent page, Python service, tools, E2E, systemd deploy.

## Status

**Done and live on dev.** All five PRs merged. `dev.fibreflow.app` runs the connector end
to end: a user can complete the full OAuth 2.1 round trip and read real FibreFlow data as
themselves, read-only. **Production is untouched** and needs Hein's approval.

Two Definition-of-Done items remain, both needing a human or a second account: adding the
connector through the **claude.ai UI** (the protocol flow is proven, the UI path is not),
and the **two-user scoping check**.

⚠️ **Dev is behind master.** Dev runs `d96d677e8`; master is `865c2e75c`, **eight PRs
ahead** — seven from *other* sessions (#2303 agent-docs, #2304 1Map GPS fallback, #2305
ambiguous pole matches, #2306 1Map contact sync, #2307 serial receipt batching, #2308
DR-photo resolver, #2309 deploy control script) plus this session's docs-only #2302.
Nothing connector-related is missing from dev. Redeploying dev would pull in those other
sessions' work — check with them before doing it. Recount with
`git log --first-parent --oneline d96d677e8..865c2e75c` rather than trusting this list.

## What got done this session

| PR | Lands |
|---|---|
| [#2294](https://github.com/VelocityFibre/FF_Next.js/pull/2294) | `pages/api/mcp/consent.ts` — mints the token, calls the service back, deletes the session on any failure |
| [#2295](https://github.com/VelocityFibre/FF_Next.js/pull/2295) | `pages/mcp/authorize.tsx` + `src/components/mcp/McpConsentCard.tsx` — the consent screen |
| [#2298](https://github.com/VelocityFibre/FF_Next.js/pull/2298) | `apps/ff_mcp/{config,oauth,server,tools,catalogue}.py` — OAuth 2.1 AS + 3 tools |
| [#2299](https://github.com/VelocityFibre/FF_Next.js/pull/2299) | `deployment/systemd/ff-remote-mcp.service`, `.claude/modules/ff-remote-mcp.md`, `pages/api/mcp/resource-metadata.ts` |
| [#2302](https://github.com/VelocityFibre/FF_Next.js/pull/2302) | Docs: the Cloudflare User-Agent dependency |

- Deployed dev via `bash scripts/deploy-local.sh dev` → `d96d677e8`, health 200.
- Installed `ff-remote-mcp.service` as a **user** unit, enabled and running on `127.0.0.1:7416`.
- Secret written to `~/.ff-remote-mcp.env` (0600) and appended to
  `/home/velo/fibreflow-dev/.env.local` as `FF_MCP_CALLBACK_SECRET` + `FF_REMOTE_MCP_URL`
  (timestamped backup of that file taken first).
- Tests: **57 JS + 66 Python**, every new one mutation-checked.

## What's next

1. **Add the connector in claude.ai** against
   `https://dev.fibreflow.app/api/ff-remote-mcp/mcp` — no client ID or secret, DCR issues
   them. Confirm the UI path works; only the raw protocol flow has been proven.
2. **Two-user scoping check** — a second user's connector must return *their* `/api/meetings`,
   not everyone's. This is the property that justifies per-user OAuth over a service token
   and is the last untested one.
3. **Decide whether to redeploy dev** to pick up master (see the warning above — it carries
   other sessions' work).
4. **Production, only with Hein's approval and after hours.** Needs: prod deploy, a
   **separate** `FF_MCP_CALLBACK_SECRET` + `FF_REMOTE_MCP_URL` in the prod app env, and a
   systemd drop-in overriding `WorkingDirectory`, `FF_REMOTE_MCP_PORT`, `StateDirectory`
   **and** `EnvironmentFile`. The base unit is dev-shaped and one-instance-per-host is the
   documented assumption. The connector's own env is only `FF_MCP_CALLBACK_SECRET`,
   `FF_REMOTE_MCP_URL` and `FF_REMOTE_MCP_PUBLIC_BASE` — `FF_MCP_TOKEN_UI_ENABLED` is
   **not** part of it (it gates the unrelated read-only MCP *token* UI in
   `pages/api/me/mcp-tokens*` and `pages/cortex.tsx`; no connector file reads it, so decide
   it on that feature's own merits).

## Open questions / blockers

- Both remaining DoD items need Hein (a claude.ai account and a second FibreFlow user).
- Two plan questions were never answered: does the dev connector stay registered once prod
  is live, and should H&S medical/incident routes be denylisted from the connector?

## Context the next session needs

**Three things the plan specified would have shipped broken:**

- **`/api/health` cannot validate a token.** It is unauthenticated and returns 200 for any
  `Authorization` header, so the plan's validation step would have bound a garbage token to
  a live OAuth grant. Uses `GET /api/auth/me` (behind `withAuth`). Do not "simplify" back.
- **Cortex's `_HTTPS` evaluates to `"http://s"`** — it derives it as `_HTTP + "s"`. Copying
  the OAuth provider verbatim would have made every https default malformed.
- **`ProtectedRoute`'s `fallbackPath` is `/login`, which is not a route in this app** (it is
  `/sign-in`), and it drops the query string. The consent page does its own redirect so
  `state_id` survives login.

**Two defects I introduced, both caught by blind review:**

- **Host-header injection into OAuth discovery (HIGH).** I wrote a comment asserting the edge
  sets `x-forwarded-host` without checking — `docs/VPS/*.conf` set `Host`, `X-Real-IP`,
  `X-Forwarded-For`, `X-Forwarded-Proto` and never touch it. Combined with the
  `Cache-Control: public` I had set, a spoofed request could poison another user's discovery
  document toward an attacker's authorization server. Now an allow-list with `no-store`.
  **A security comment asserting an infra property must cite the config.**
- **My own fix created a race.** Making `fibreflow_get` async put it on a real thread pool, so
  the stale-key sweep added in the same round began iterating `_call_times` while other
  threads mutated it. Now under a `threading.Lock`. **A change to the concurrency model
  invalidates the reasoning behind every other change made alongside it.**

**Four decorative tests, all found by mutation testing, none by reading:**

- Double-click guard: `fireEvent.click` flushes `act()`, so the test was exercising the
  `disabled` attribute, not the guard. Deleting the guard passed all 11 tests.
- Python path guards: asserted only "an error came back" — with the guard deleted an
  unauthenticated call still errored, for a different reason.
- Startup secret guard: order-dependent after a module split; run after any test that had
  already imported `config`, it executed nothing and passed.
- `test_callback_rejects_an_unknown_state`: asserted only `status_code == 400`, which a
  downstream error produced identically.

**Concurrency tests need calibration, not just threads.** My first race test passed against
the *unlocked* code. CPython switches threads every 5ms and a short comprehension finishes
inside one slice. Reproducing it needed `sys.setswitchinterval(1e-6)` **and** a 4000-key
dict. I calibrated in a standalone harness (failed 7/7) before writing the test. *A green
concurrency test proves nothing until you have watched it go red.*

**A mutation that "survives" is either a missing test or a mutation that never applied.** Two
of mine never applied — perl pattern used double quotes against single-quoted source.
Confirm the mutation landed (`grep -c`) before concluding a line is well tested.

**Cloudflare 403s the default Python User-Agent** (`Error 1010`). Measured on dev:
`Python-urllib/3.12` → 403, `ff-remote-mcp/0.1` → 200. The explicit `User-Agent` headers in
`tools.py` and `server.py` are load-bearing — strip them and every tool call fails against
an HTML error page. Only observable against the real edge, not a local build.

**`JWT_SECRET` is not in `/home/velo/fibreflow-dev/.env.local`** — it lives in
`.env.production`, which Next loads because the dev unit sets `NODE_ENV=production`.

**Credential incident, handled.** The `playwriter` MCP tool **echoes its params in error
messages**; two `addCookies` calls failed and printed real super-admin session JWTs into the
transcript. Both sessions were deleted within a minute (`kind='mcp'` count now 0).
`JWT_SECRET` was never exposed, so nothing needs rotating. **Do not pass secrets to
`playwriter.execute`.**

**Verified live on dev** (not inferred): DCR 201 · `/authorize` 302 to the consent page ·
`/api/mcp/consent` 200 with no token in the body · token exchange 200 with PKCE ·
`fibreflow_get /api/projects` returned real rows · `POST` with the connector token 403
`MCP_READ_ONLY` while `GET` 200 · session row `kind='mcp' label='Claude connector'` 90d with
`last_used_at` populated · deleting the row made the same OAuth token 401 `SESSION_INVALID`
· denylist refuses `/api/Accounting/ledger` and `/api/%73taff/list` (the case/encoding bypass).

## Git state

- **Uncommitted:** clean in this worktree. The **main tree** at
  `/home/hein/Workspace/FF_Next.js` has its long-standing ~389-entry drift and sits at
  `28ed65985` — pre-existing, unrelated, and the `ff-next-worktree-guard` hook blocks writes
  there.
- **Unpushed commits:** none beyond this handoff.
- **Stashes:** 3, all pre-existing (`metrics wip before master switch`,
  `pre-ff-2026-06-16-c7ead6653`, `WIP on fix/deploy-migration-gate-skip`).
- **Background processes:** 0 `gh run watch`, 0 stray `next build`/`vitest`, 0 test-db
  containers. **1 intentional:** `python3 -m ff_mcp` (PID 3640487) — that is the dev service
  under systemd, **do not kill it**.
- **Worktrees:** 25 open, none from this session (all 5 of mine were removed; `node_modules`
  symlink `rm`'d first each time, real directory intact at 1021 packages). Three stale
  MCP-era ones remain from *earlier* sessions and are worth pruning: `FF_Next.js-ff-mcp`,
  `FF_Next.js-mcp-tokens`, and a `/tmp/.../stack-wt2` holding `feat/mcp-f-login-dry-ui`.

## Where to resume

```bash
git fetch origin && git log origin/master --oneline -10
cat .claude/modules/ff-remote-mcp.md          # ports, env, OAuth chain, revocation, gotchas
systemctl --user status ff-remote-mcp
curl -s https://dev.fibreflow.app/.well-known/oauth-protected-resource/api/ff-remote-mcp/mcp
```

Then add `https://dev.fibreflow.app/api/ff-remote-mcp/mcp` as a custom connector in claude.ai.
