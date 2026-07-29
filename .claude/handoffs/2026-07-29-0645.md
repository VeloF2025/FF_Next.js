# Handoff — 2026-07-29 06:45 SAST

**Project:** FF_Next.js (FibreFlow)
**Session goal:** Remote MCP connector plan Tasks 4–9 (consent API + consent page + Python service + tools + E2E + deploy).

## Status

**All four PRs open, CI green, blind-reviewed, review findings fixed. Nothing merged yet. Nothing deployed to dev or prod.**

Blind review ran **two rounds** and found **~20 issues across the four PRs, including
two HIGHs**. Every finding was reproduced before fixing; two were disputed with
evidence rather than changed (reconciliation comments on each PR). Tests grew
36→66 (Python) and 35→57 (JS).

**Merge in dependency order: #2294, #2295, #2298, then #2299 last.** #2299 ships the
systemd unit and a doc describing a working service; until #2298 puts `apps/ff_mcp/`
on master, enabling that unit crash-loops it into a failed state. Both files now carry
a warning, but the order removes the window.

| PR | Branch | Tasks | CI |
|---|---|---|---|
| [#2294](https://github.com/VelocityFibre/FF_Next.js/pull/2294) | `feat/mcp-consent-api` | 4 — `pages/api/mcp/consent.ts` | pass |
| [#2295](https://github.com/VelocityFibre/FF_Next.js/pull/2295) | `feat/mcp-consent-page` | 5 — `pages/mcp/authorize.tsx` | pass |
| [#2298](https://github.com/VelocityFibre/FF_Next.js/pull/2298) | `feat/mcp-python-service` | 6+7 — `apps/ff_mcp/` | pass |
| [#2299](https://github.com/VelocityFibre/FF_Next.js/pull/2299) | `feat/mcp-deploy-and-docs` | 9 + discovery fix | pass |

All four are based on `master` (not stacked) — deliberately, so each gets real CI. All four trial-merged cleanly AND the suites were re-run on the merged tree: **63 JS + 36 Python pass**.

## Task 8 (E2E) — done, but NOT on dev

The full round trip was proven against a **production build of the trial-merged tree** running locally on :3011, with the Python service on :7416, against the **real shared Postgres**. Evidence is pasted on #2294 and #2295. Proven end to end:

DCR 201 → `/authorize` 302 → consent page 200 → `POST /api/mcp/consent` 200 (mints, calls back, returns `redirectUrl`, **no token in the body**) → code→token exchange 200 with PKCE → `initialize` → `tools/list` → `fibreflow_get /api/projects` **returned real project rows**.

Also verified: session row `kind='mcp' label='Claude connector'` 90d with `last_used_at` populated · consent failure ⇒ 502 and **zero orphan sessions** · `POST` with the connector token ⇒ **403 `MCP_READ_ONLY`** while `GET` ⇒ 200 · revoking the row ⇒ same OAuth token now 401 `SESSION_INVALID` · denylist and non-`/api` paths refused · browser check: unauthenticated `/mcp/authorize?state_id=X` redirects to `/sign-in?returnUrl=…state_id%3DX` with the **state_id intact**.

**Still outstanding for a literal "Task 8 on dev":** merge, `bash scripts/deploy-local.sh dev`, install the systemd unit on velo, then add the connector in claude.ai against `https://dev.fibreflow.app/api/ff-remote-mcp/mcp`. Two Definition-of-Done items were NOT covered locally: adding it through the real claude.ai UI, and the **two-user scoping check** (two connectors returning different result sets).

## Things the plan got wrong (all fixed, all worth knowing)

1. **`/api/health` cannot validate a token.** It is unauthenticated and 200s for any `Authorization` header. The plan said to validate the minted token there — it would have bound a garbage token to a live grant. Uses `GET /api/auth/me` (behind `withAuth`).
2. **Cortex's `_HTTPS` is `"http://s"`** — it derives it as `_HTTP + "s"`. Copying the OAuth provider verbatim would have shipped `http://sapp.fibreflow.app` as every default.
3. **"AppLayout handles the login redirect" is false.** `ProtectedRoute.fallbackPath` is `/login`, **which is not a route in this app**, and it drops the query string. The consent page does its own `/sign-in?returnUrl=<asPath>`.
4. **`--ff-bg-card` is declared only in the dark block** of `globals.css` — a card using it has no background in light mode. Convention is card `--ff-bg-secondary` on page `--ff-bg-primary`.
5. **The RFC 9728 well-known file was a static file hardcoding prod.** Served from dev it advertised **production** as the authorization server. Replaced with a host-aware API route + `next.config` rewrite (#2299).
6. **`complete_pending` pops the state**, so validating the token after consuming it burns the request on a transient failure. Added `peek_pending`.

## What blind review caught that mutation testing did not

- **HIGH, #2299 — host-header injection into OAuth discovery.** My comment claimed the
  edge sets `x-forwarded-host`. It does not: `docs/VPS/*.conf` set `Host`, `X-Real-IP`,
  `X-Forwarded-For`, `X-Forwarded-Proto` and never touch it. Combined with the
  `Cache-Control: public` the handler itself set, a spoofed request could poison another
  user's discovery document toward an attacker's OAuth server. **Lesson: a security
  comment that asserts an infra property must cite the config, or it is hand-waving.**
- **#2298 — the denylist was case- and encoding-bypassable.** `/api/Accounting/ledger`
  and `/api/%73taff/list` sailed through. Next.js lower-cases route dirs and decodes
  before routing, so the guard has to run on the canonical path, not the raw string.
- **#2298 — the tools blocked the event loop.** FastMCP calls a *sync* tool inline
  (`func_metadata.py: return fn(**args)`), so one slow upstream stalled every user for
  30s. Now `async` + `anyio.to_thread`.
- **#2299 — `ReadWritePaths` named a directory nothing created.** Under
  `ProtectSystem=strict` that fails namespace setup *before* `ExecStartPre` runs, so the
  unit would not have started on a clean host. `StateDirectory` is the right mechanism.
- **#2298, round 2 — my own fix introduced a race.** Making `fibreflow_get` async put it
  on a real thread pool, so the stale-key sweep added in the same round began iterating
  `_call_times` while another thread inserted into it. Now under a `threading.Lock`.
  **Lesson: a fix that changes the concurrency model invalidates the reasoning behind
  every other change in the same round.**
- **#2298, round 2 — a decorative test on a security path.** `test_callback_rejects_an_
  unknown_state` asserted only `status_code == 400`, and deleting the `peek_pending`
  guard still produced 400 because `complete_pending` raises the same error downstream.
  Proving a guard fired means proving what came *after* it did not run.

## Test-quality lessons (three decorative tests caught by mutation testing)

Mutation testing found **three tests that asserted nothing**, each of which looked fine:

- **Double-click guard (page).** `fireEvent.click` flushes `act()`, so the button was already disabled for the second click — deleting the guard entirely passed all 11 tests. Fixed by dispatching both clicks inside one `act()`. The guard itself was also wrong: it used a `setPhase` updater, and React batches those, so it never gated anything. Now a `useRef`.
- **Path guards (Python).** Asserted only "an error came back" — with the guard deleted, an unauthenticated call still errored on the missing credential. Now asserts the specific rejection AND that `urlopen` is never reached.
- **Startup secret guard (Python).** After the module split the guard moved to `config.py`, which the test helper did not evict from `sys.modules`; run after any test that had already imported config, it executed nothing and passed. Proven order-dependent (`DID NOT RAISE`), then fixed.

**Generalisable:** a mutation that "survives" is either a missing test or a mutation that never applied. Two of mine never applied because the perl pattern used double quotes against single-quoted source. Always confirm the mutation landed (`grep -c`) before concluding a line is well tested.

**Concurrency tests need calibration, not just threads.** My first race test — 12 threads,
40 calls each — passed against the *unlocked* implementation. CPython switches threads
every 5ms by default and a short comprehension finishes inside one slice. Reproducing it
needed `sys.setswitchinterval(1e-6)` plus a dict large enough that the comprehension spans
a switch; I calibrated in a standalone harness (8 threads, 4000 keys → failed 7/7) before
writing the test. A green concurrency test proves nothing until you have watched it go red.

## Credential incident — handled, no action needed

The `playwriter` MCP tool **echoes its params in error messages**. Two `addCookies` calls failed and printed real `ff_auth_token` JWTs for `hein@velocityfibre.co.za` (super_admin) into the transcript. Both sessions were deleted from `user_sessions` within a minute; `SELECT count(*) … WHERE label='e2e browser session'` → **0**. The JWTs are dead — both auth wrappers require the session row. Nothing to rotate (`JWT_SECRET` was not exposed). **Do not pass secrets to `playwriter.execute`.**

## Environment left clean

- Test processes on :3011 and :7416 stopped (killed by explicit PID).
- `~/.ff-remote-mcp.env` and `~/.ff-remote-mcp/oauth.json` deleted.
- `.env.local` and the e2e scripts removed from the trial worktree — **nothing secret is tracked**.
- **Worktrees created this session (4, all still present, none removed):** `FF_Next.js-mcp-consent`, `-mcp-consent-page`, `-mcp-service`, `-mcp-deploy`, plus a detached `-mcp-trial`. Each has a `node_modules` **symlink** — `rm` the symlink BEFORE `git worktree remove --force`, or it wipes the real directory.

## Where to resume

1. Merge in any order — they are independent, all CI-green, all reviewed. (The four
   were re-trial-merged after the fixes: 139 tests pass on the merged tree and the full
   OAuth round trip was re-run on it.)
2. `bash scripts/deploy-local.sh dev`.
3. Install the unit on velo: copy `deployment/systemd/ff-remote-mcp.service` to `~/.config/systemd/user/`, create `~/.ff-remote-mcp.env` (chmod 600) with `FF_MCP_CALLBACK_SECRET`, `FF_APP_BASE=https://dev.fibreflow.app`, `FF_REMOTE_MCP_PUBLIC_BASE=https://dev.fibreflow.app/api/ff-remote-mcp`; add the same secret + `FF_REMOTE_MCP_URL=http://127.0.0.1:7416` to the dev app env; `systemctl --user enable --now ff-remote-mcp`.
4. Add the connector in claude.ai and do the two-user scoping check.
5. **Production is untouched and requires Hein's explicit approval.** Do not set `FF_MCP_TOKEN_UI_ENABLED` on prod.
