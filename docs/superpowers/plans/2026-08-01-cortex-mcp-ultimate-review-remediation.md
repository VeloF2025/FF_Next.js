# Cortex MCP Ultimate-Review Remediation Plan

> **Execution rule:** use strict TDD and the subagent-driven workflow. One implementer owns each task; a different reviewer inspects the exact commit range. Do not push, deploy, restart services, edit an environment, log in, register/revoke a live client or token, or change a live allowlist while executing this plan.

**Goal:** Close every actionable finding from the fresh blind security and coordinated reviews at the synchronized Cortex/FibreFlow heads: exact privileged-email matching, a bounded dynamic-client store plus edge abuse controls, revision-backed deploy verification, and a finite/sanitized FibreFlow Cortex proxy.

**Architecture:** Keep FibreFlow's verified session and Cortex's signed bearer as the only identity authority. Ordinary membership email normalization may continue folding `+tag` aliases for mailbox/channel lookup, but privileged policy uses a separate exact trim-and-case-fold predicate shared by all read surfaces. Dynamic client registration remains enabled for normal SDK discovery, while Cortex bounds persisted clients and FibreFlow meters public `/register` and `/authorize` requests before forwarding. Scoped Cortex restarts remain supported; each restarted process receives an atomic deployment adoption record binding its unit, exact process identity, checkout revision, and relevant-code equivalence. The public proxy forwards only after a sanitized per-client limit check, uses a finite upstream deadline, and never logs or returns an OAuth-bearing URL.

**Frozen starting heads:**

- Cortex feature: `20a298729df276cf5bb9125018103bd3101f2c13`
- Cortex target: `origin/main` at `c3667872e0a7558f995037aa994409f83a4378f7`
- FibreFlow feature: `98911aff90627b18aa80df028f5b42e014942437`
- FibreFlow target: `origin/master` at `b077d8d23fa981b6c8b967d774030a20af737016`
- FibreFlow is five target commits behind at plan creation. Integrate that target with a normal merge before implementation; never rewrite or force-push history.

## Locked decisions

1. Privileged email matching means surrounding whitespace removed plus case-insensitive comparison only. It must never strip `+tag`, alter the local part, match a suffix, or share ordinary membership alias normalization.
2. `lew@velocityfibre.co.za` and every existing `CORTEX_SUPER_ADMIN_EMAILS` entry keep full Velocity Fibre tenant read authority. No entry is replaced, and no email is added to a write/admin allowlist.
3. Query, facts, entity, meeting detail, and meeting pack use one shared exact super-admin predicate. Tenant binding and all existing read-only/write separation stay unchanged.
4. Dynamic client registration stays enabled because SDK clients need it. The persisted client collection receives a hard positive default cap of 512, configurable by `CORTEX_MCP_MAX_CLIENTS` with defensive parsing.
5. Before registering, reclaim oldest clients that are not referenced by pending authorizations, codes, access tokens, or refresh tokens. If every slot is referenced, refuse the new registration without mutating disk; never evict an active grant merely to admit an anonymous registration.
6. Loading an oversized historical store reclaims safe unreferenced clients as far as possible and prevents further growth. Documentation must state that the cap bounds growth but is not abuse prevention and that a fully active cap can temporarily refuse registration.
7. FibreFlow meters only the public Cortex OAuth entry points: `POST /register` at 30 requests/minute and `GET /authorize` at 60 requests/minute per trusted edge client IP. Other MCP JSON-RPC/token traffic retains current behavior.
8. The rate-limit key is a fixed endpoint label plus the Nginx-overwritten `X-Real-IP`, falling back to the socket address. It never includes the raw URL, query, `state`, authorization code, body, or attacker-supplied first `X-Forwarded-For` value.
9. The in-process limiter is appropriate for the current single FibreFlow service. The provider cap remains the invariant if that edge control is bypassed or reset.
10. The Cortex proxy gets a finite default upstream timeout, defensively configurable for isolated tests/operations, with a generic 502 before headers or a destroyed socket after streaming begins. Timeout/error responses and logs expose no URL, query, token, state, or raw exception text.
11. Cortex deploy freshness is not inferred from commit author timestamps. A successful restart is adopted only after real PID/CWD/start-identity/stability checks; an atomic per-unit record binds that live process to the checked-out revision.
12. A previously adopted unit may remain running across an unrelated scoped deploy only when its live PID/start identity still matches its record and `deploy_scope.py` proves no relevant code differs between the recorded revision and target HEAD. Missing, malformed, mismatched, or unreachable provenance fails closed and causes restart/failing verification.
13. `--verify-only` remains read-only. Adoption records are written only during the normal deploy path after runtime and health evidence; a failed or unproved process is never adopted. The success message must describe per-unit relevant-revision proof, not claim every process was restarted on the latest whole-tree HEAD.
14. All new tests exercise real production functions and real temporary files/sockets/process metadata seams. Do not add mocked transports, fake stores, or tautological source-string checks as the substantive proof.

---

## Task 17A: Make super-admin matching exact and shared

**Expected Cortex files:**

- Modify `plugins/memory/cortex/membership.py`
- Modify `apps/bridge/routes/meetings_deps.py`
- Modify focused membership, signed-route, full-tenant, and meeting tests

### Required contract

1. Add a clearly named privileged-email normalizer/predicate that trims and case-folds only. Preserve `norm_email` unchanged for ordinary membership storage/lookup compatibility.
2. Build `SUPER_ADMIN_EMAILS` through the privileged normalizer and expose one shared `is_super_admin_email` predicate.
3. Use that predicate in both principal membership resolution and meeting `full_tenant_read` derivation. Remove direct duplicated membership tests from the meeting route.
4. Signed exact Lew and every configured pre-existing entry receive full tenant query/facts/entity/meeting reads only inside the verified tenant. Uppercase variants succeed.
5. `lew+other@velocityfibre.co.za`, suffix/prefix near misses, blank identities, and foreign-tenant contexts remain narrowed or denied. Meeting/admin/platform write guards stay 403 and mutation-free.

### TDD and verification

- First add RED signed-HS256 production-route cases for query, facts, entity, meeting detail, and meeting pack using exact, uppercase, plus-tag, suffix, ordinary, and foreign-tenant identities.
- Add pure tests proving membership alias folding still works for ordinary channel lookup while privileged matching does not fold aliases.
- Run the focused principal/ACL/route suites, mutate the shared predicate and each tenant/write guard separately, restore GREEN, run changed-file Ruff and `git diff --check`, then commit:

```text
fix(auth): require exact privileged email matches
```

Obtain an independent security review before Task 17B.

---

## Task 17B: Bound dynamic registration and meter public OAuth entry points

**Expected Cortex files:**

- Modify `apps/cortex_mcp/cortex_mcp_oauth.py`
- Modify `apps/cortex_mcp/cortex_mcp_store.py` only if a small store-owned helper is clearer
- Modify `tests/test_cortex_mcp_oauth.py` and focused real-store limit tests
- Modify `docs/cortex-mcp-connect.md`

**Expected FibreFlow files:**

- Modify `pages/api/cortex-remote-mcp/[...path].ts`
- Modify `src/lib/rateLimiter.ts` only if a small bounded/testable capability is required
- Modify or add focused real-HTTP route tests under `tests/api/`
- Modify the committed design/implementation docs where they describe flood resistance or rollout prerequisites

### Required contract

1. Cortex computes referenced client IDs across pending, code, access, and refresh buckets without trusting malformed rows. Registration prunes oldest unreferenced clients until below the cap, then registers and saves once.
2. A cap occupied entirely by referenced clients rejects the new registration generically, preserves every existing client/grant byte-for-byte, writes nothing, and never returns/logs secrets.
3. Malformed/non-positive `CORTEX_MCP_MAX_CLIENTS` values safely fall back to 512. Restart/reload preserves the cap result.
4. A real temporary store subjected to at least 520 production-provider registrations never persists more than 512 clients; referenced clients survive reclamation and evicted clients no longer resolve.
5. FibreFlow checks the exact method/path before reading the body or opening an upstream connection. The 31st `/register` request and 61st `/authorize` request from the same trusted client in a live window return exact 429 JSON plus `Retry-After`; a different trusted IP gets an independent bucket.
6. Spoofing `X-Forwarded-For`, changing query/state, or alternating OAuth parameters does not evade a bucket. Non-target MCP/token routes are unaffected.
7. The limiter's keys/entries expire and do not retain OAuth material. Logs contain only a sanitized endpoint label and bounded client-IP metadata.

### TDD and verification

- Write provider RED tests against real `OAuthStore` files and production `register_client`; include high-volume registration, active references, reload, malformed rows, refusal, save-count, and no-secret assertions.
- Write FibreFlow RED tests through real Node `http.Server` proxy/upstream sockets and the real limiter. Do not mock `fetch` or the limiter.
- Mutate client pruning, active-reference protection, cap refusal, trusted-IP selection, endpoint separation, and 429-before-forwarding in turn and require a focused failure.
- Run focused Pytest/Vitest, Ruff/ESLint/type-check for changed files, both diff checks, and FibreFlow secret scan. Commit separately:

```text
fix(oauth): bound dynamic client registrations
fix(mcp): rate limit public cortex oauth routes
docs(mcp): state layered oauth flood controls
```

Obtain independent Cortex security and coordinated cross-repository reviews before Task 17C.

---

## Task 17C: Replace timestamp freshness with revision-backed process adoption

**Expected Cortex files:**

- Modify `scripts/deploy_bridge.sh`
- Modify `scripts/deploy_scope.py` if needed for a real per-unit relevant-diff query
- Create one small deployment-record helper only if it keeps shell parsing safe
- Modify `tests/test_executor_deploy_contract.py` and `tests/test_deploy_scope.py`
- Modify operator wording in `docs/cortex-mcp-connect.md`

### Required contract

1. Normal deployment records, atomically and with owner-only permissions, the unit name, full deployed revision, MainPID, and systemd monotonic start identity only after the process has passed real active/not-failed, CWD, stability, and applicable health checks.
2. Unit names and record contents are validated as data, never sourced/evaluated as shell. An invalid name, SHA, PID, start identity, record path, or Git revision fails closed.
3. Verification requires the live MainPID/start identity to equal the adoption record, the CWD to equal the deploy clone, and the recorded revision to be relevant-code-equivalent to current HEAD for that unit.
4. The exact counterexample from review fails: commit at T0, old process at T1, clone advanced to HEAD at T2. Commit timestamps cannot make it green.
5. An unrelated docs/unit-excluded change can leave an adopted stable unit green without restarting it; a relevant code change, crash/restart, missing record, or tampered record cannot.
6. Normal deploy restarts any selected non-executor unit whose provenance is absent/stale even if author-time comparison would call it fresh. The selected executor keeps its mandatory executor-first restart/readiness gate.
7. `--verify-only` performs no fetch, merge, restart, link, mkdir, temp-file, move, or record write. Record creation/update is inside the normal deploy path.
8. A deployment is not declared successful until clone/submodule/health/runtime checks and final record verification all pass. Wording reports revision-backed relevant-code equivalence honestly.

### TDD and verification

- Add executable tests using a real temporary Git repository, real record files, and deterministic process identity inputs to demonstrate the T0/T1/T2 failure and relevant/unrelated diff behavior.
- Retain static contract tests only for destructive-command/time-gate/order invariants; they are not the substantive freshness proof.
- Mutate PID binding, start-identity binding, relevant-diff check, atomic record timing, and verify-only write guard separately and require failures.
- Run deploy contract/scope/heartbeat suites, changed-file Ruff/ShellCheck where available, `git diff --check`, and a read-only `deploy_bridge.sh --verify-only` against the current live clone. The known undeployed/skewed live executor must remain an honest nonzero result; do not fix it here.
- Commit:

```text
fix(deploy): bind service freshness to adopted revisions
```

Obtain an independent operations/security review before Task 17D.

---

## Task 17D: Add a finite proxy deadline and redact failure surfaces

**Expected FibreFlow files:**

- Modify `pages/api/cortex-remote-mcp/[...path].ts`
- Modify `tests/api/mcp-proxy-route-errors.test.ts`
- Add only a small proxy helper if required to keep the route under project file limits

### Required contract

1. Every upstream fetch has a finite default deadline. The test/operation override is positive, defensively parsed, and bounded; malformed values retain the safe default.
2. A stalled real upstream yields a generic 502 before response headers within the configured test deadline. If streaming has begun, the proxy destroys the downstream socket so partial data never looks complete.
3. Body-cap warnings, rate-limit warnings, fetch/timeout errors, and invalid-path warnings never include `upstreamUrl`, raw `req.url`, query, state, code, bearer, body, or raw exception objects/messages.
4. Client-facing 502/413/429 bodies are generic and contain no exception detail or OAuth material. Normal upstream status/header/body streaming and manual redirects remain unchanged.
5. Focused tests inspect the real logger's in-memory entries/process output rather than replacing the logger implementation, and drive the production handler through real HTTP sockets.

### TDD and verification

- Add RED stalled-upstream, dead-upstream-with-secret-query, over-cap-with-secret-query, midstream failure, normal response, and manual redirect cases.
- Mutate the abort signal, log redaction, response-detail removal, and headers-sent branch separately and require failures.
- Run focused real-socket Vitest, related proxy-stream/discovery tests, `npm run ci:quick`, `npm run build`, diff check, and secret scan. Commit:

```text
fix(mcp): bound and sanitize cortex proxy failures
```

Obtain an independent coordinated review before Task 17E.

---

## Task 17E: Re-run all invalidated gates and publish coordinated draft PRs

### Cortex verification

- Task 17A exact-email signed routes plus all earlier membership/full-tenant/meeting-write tests.
- Task 17B OAuth registration/store/callback/grant/revocation suites, including the real 520-registration proof.
- Task 17C deploy contract/scope/heartbeat union and the explicit T0/T1/T2 counterexample.
- Previous focused security union, real PostgreSQL revocation integration with `1 passed` rather than skipped, executor Bun tests and TypeScript, `bash scripts/ci/run-ci.sh`, Ruff, full diff check, tracked-clean state, and read-only deploy verification.

### FibreFlow verification

- Task 17B/17D real-socket proxy and limiter suites.
- Existing consent/session/callback/lifetime/connection-page Vitest suites.
- `npm run ci:quick`, `npm run build`, `npm run antihall`, `git diff --check`, and `bash scripts/secret-scan.sh` with exact exit codes and known baseline findings separated.
- Playwright/Claude-in-Chrome and real isolated DEV connector proof remain rollout evidence, not a reason to touch live credentials during PR preparation.

### Final review and publication gate

1. Refresh both target refs again and integrate drift without force. Re-run affected gates after any merge.
2. A fresh blind Cortex security reviewer inspects the full `origin/main...HEAD` diff and explicitly retests exact privileged aliases, DCR bounds, OAuth grants, read-only surfaces, and deploy provenance.
3. A different fresh coordinated reviewer inspects both full diffs, real-socket edge controls, documentation truth, deployment order, and rollback.
4. Only after both approve: push through `gh`, open cross-linked **draft** Cortex and FibreFlow PRs, and report exact heads/checks/review evidence.
5. Stop before merge or deployment. Production callback secret, allowlist/readback, external proxy acceptance, login, isolated real OAuth/SDK/zero-filesystem connector proof, live executor reconciliation, DEV deployment, and production promotion remain explicit rollout gates.
