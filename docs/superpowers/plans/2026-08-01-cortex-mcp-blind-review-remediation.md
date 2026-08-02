# Cortex MCP Blind-Review Remediation Implementation Plan

> **Required execution mode:** Use subagent-driven development one task at a time. Every implementation task gets a fresh implementer, then a fresh task reviewer. Any finding returns to the same implementer for a bounded fix round.

**Goal:** Close the final blind-review blockers so every marked Cortex MCP operation is operationally read-only, every advertised tool is callable through the authoritative matrix, revocation has real PostgreSQL proof, and the supported Cortex rollout deploys the hardened Agent Executor before the Bridge.

**Repositories:**

- FibreFlow: `/home/hein/Workspace/FF_Next.js-cortex-token-lifetimes`
- Cortex: `/home/hein/Workspace/Cortex-mcp-readonly-lifetimes`

**Starting heads:**

- FibreFlow: `6c5fe7a535a147e674f401225d20284dcb52708b`
- Cortex: `580fc25336878770a15fbf0e6954ba2734545e4f`

**Non-negotiable boundaries:**

- Preserve existing FibreFlow OAuth/RBAC and the normal no-token-paste connector flow.
- Derive user identity only from the verified FibreFlow session and verified Cortex claims.
- Keep normal browser consent fixed at `90d`; keep Advanced manual lifetimes `30d`, `90d`, `1y`, and `never` with no super-admin lifetime cap.
- Preserve every deployed `CORTEX_SUPER_ADMIN_EMAILS` entry; Lew's exact address is `lew@velocityfibre.co.za` and his approved scope is full Velocity Fibre Cortex tenant read access.
- A marked MCP bearer is read-only. Self-revocation is the sole admitted mutation.
- The unverified marker parser may deny only; verified `require_auth` remains authoritative for identity and grants.
- Use a separate `CORTEX_MCP_CALLBACK_SECRET`; never reuse `FF_MCP_CALLBACK_SECRET`.
- Use real production functions, signed tokens, routing, loopback HTTP, and a disposable real PostgreSQL transaction. A mock or SQL-string assertion alone is not security proof.
- Do not change live env files, deployed allowlists, services, OAuth stores, or production state. Do not deploy or merge. All code goes through coordinated PRs.
- Real DEV OAuth uses isolated ports, OAuth store, public base, Bridge, and Agent Executor. Never point the proof at production port `7406` or the production authorization flow.

---

### Task 9: Prevent marked retrieval and answer paths from writing or bypassing ACL policy

**Cortex files:**

- Modify `apps/bridge/routes/query.py`
- Modify `apps/bridge/routes/timeline.py`
- Modify `apps/bridge/routes/answer.py`
- Modify `tests/test_query_route_acl.py`
- Modify `tests/test_timeline_route.py`
- Modify `tests/test_answer_route.py`
- Modify `tests/test_answer_metric_route.py`

**Interfaces:**

- `is_mcp_token(_auth or {})` is the single decision for marked behavior.
- Marked `/api/query`, `/api/timeline`, and `/api/answer` never call persistent JIT enrichment.
- Unmarked session/service behavior retains the current JIT path.
- Marked `/api/answer` bypasses Tier-2 metrics entirely and continues through ACL-filtered retrieval plus isolated read-only synthesis.
- Unmarked Tier-2 metric behavior remains unchanged.

- [ ] **Step 1: Add mutation-sensitive signed-route RED tests**

For each of query, timeline, and answer, send a real HS256 marked bearer through the production `require_auth` dependency and the real route. Return an unenriched `pst_archive` point from the narrow retrieval seam. Keep the production `enrich_points_jit` function installed; replace only its external enricher/Qdrant boundaries so `call_enricher` returns a deterministic enrichment and `_patch_qdrant` raises `AssertionError("marked retrieval attempted durable JIT write")` if reached.

Expected RED: all three marked routes reach the production JIT function and fail.

Add an unmarked signed-session control that records one `_patch_qdrant` call, proving normal retrieval still enriches and persists.

- [ ] **Step 2: Add the marked metric RED test**

Enable `CORTEX_TIER2_METRICS`, send a real signed marked bearer with a metric-shaped question, and install `run_metric` as a bomb. Allow the normal ACL-filtered RAG path to complete through narrow retrieval/executor boundaries.

Expected RED: the marked request reaches `run_metric` before ACL retrieval.

- [ ] **Step 3: Implement the fail-closed branch**

In each read route, compute the marked-token boolean from verified `_auth`. Run `enrich_points_jit` only when false. In answer, guard the entire Tier-2 metric block with `not read_only_synthesis`.

Do not accept a body/header flag for either decision. Do not change unmarked route behavior.

- [ ] **Step 4: Verify GREEN and mutation sensitivity**

Run:

```bash
python3 -m pytest tests/test_query_route_acl.py tests/test_timeline_route.py tests/test_answer_route.py tests/test_answer_metric_route.py -q
```

Temporarily invert each marked guard. The matching signed-route test must fail by reaching the Qdrant/metric bomb. Restore and rerun GREEN.

- [ ] **Step 5: Commit Cortex Task 9**

Commit only the seven Task 9 files with:

```text
fix(mcp): keep marked retrieval paths non-persisting
```

---

### Task 10: Enforce canonical fact-child segments in both policy layers

**Cortex files:**

- Modify `plugins/memory/cortex/mcp_access.py`
- Modify `tests/test_mcp_access.py`

**FibreFlow files:**

- Modify `pages/api/cortex-bridge/[...path].ts`
- Modify `pages/api/cortex-bridge/__tests__/[...path].test.ts`

**Interfaces:**

- A fact ID remains a single decoded path segment.
- Reject empty segments, exact `.`/`..`, `/`, `\\`, and residual `%` in both repositories.
- Residual `%` rejection closes double-encoding; it does not change ordinary hyphenated fact keys.
- Every denied marked/bearer request receives generic 403 and never reaches a handler/upstream fetch.

- [ ] **Step 1: Add cross-repository RED cases**

Cover literal and encoded forms that resolve to:

```text
/api/facts/.
/api/facts/..
/api/facts/\evil
/api/facts/%2e
/api/facts/%252e
/api/facts/a%252fb
```

Use the real Cortex app with a signed marked JWT and the real FibreFlow proxy handler with a bearer header. Assert generic 403. Assert `/api/facts/ops-fact-1` remains allowed to proceed through verified auth/upstream.

Expected RED: at least dot, backslash, and residual-encoding cases pass the current child matcher.

- [ ] **Step 2: Implement one explicit safe-segment predicate per repository**

Do not depend on framework normalization. Apply the predicate before the existing child allow decision. Keep meeting-ID validation unchanged.

- [ ] **Step 3: Verify both repositories**

```bash
python3 -m pytest tests/test_mcp_access.py -q
npx vitest run 'pages/api/cortex-bridge/__tests__/[...path].test.ts'
```

Temporarily remove residual-`%` and backslash rejection; the new cases must fail. Restore.

- [ ] **Step 4: Commit both repository changes separately**

Cortex:

```text
fix(mcp): reject noncanonical fact paths
```

FibreFlow:

```text
fix(cortex): reject noncanonical fact proxy paths
```

---

### Task 11: Publish only tools admitted by the marked-token matrix

**Cortex files:**

- Modify `apps/cortex_mcp/server.py`
- Modify `tests/test_cortex_mcp.py`

**Interfaces:**

- The remote registry contains exactly these callable tools:

```text
cortex_query
cortex_search
cortex_meeting_get
cortex_meeting_pack
cortex_answer
cortex_timeline
cortex_facts
cortex_entity_profile
```

- `cortex_chat`, `cortex_connections_top`, `cortex_connections_egocentric`, `cortex_evidence_pack`, and `cortex_gap_analysis` are not registered on the remote OAuth surface.
- Their plain Python helpers may remain for internal/backward-compatible code, but no `@mcp.tool()` decorator may publish them.
- Never allowlist `/api/chat` for marked tokens.

- [ ] **Step 1: Change the registry contract test first**

Assert the actual `mcp._tool_manager._tools` key set equals the eight-name set above. Also assert every registered helper resolves only to a route admitted by `is_mcp_request_allowed`.

Expected RED: the five unsupported names remain registered.

- [ ] **Step 2: Remove only the unsupported decorators**

Keep supported descriptions honest: query/timeline/answer are ACL-filtered and non-persisting for marked callers; facts/entity are full-tenant-scope-only while per-user provenance remains unresolved.

- [ ] **Step 3: Verify GREEN and direct helper regressions**

```bash
python3 -m pytest tests/test_cortex_mcp.py tests/test_mcp_access.py -q
```

Temporarily restore one unsupported decorator; the exact-set test must fail.

- [ ] **Step 4: Commit Cortex Task 11**

```text
fix(mcp): align published tools with bearer policy
```

---

### Task 12: Prove monotonic revocation in a disposable real PostgreSQL transaction

**Cortex files:**

- Create `tests/test_mcp_revocation_postgres.py`
- Modify `tests/test_mcp_revocation.py` only if a small shared assertion helper is necessary
- Modify `docs/superpowers/plans/2026-08-01-cortex-mcp-token-security-remediation.md` to name the real-Postgres gate

**Interfaces:**

- The integration test connects to PostgreSQL through the repository's normal `DB_PARAMS` environment.
- It creates `pg_temp.mcp_token_revocation` in one connection/transaction; no permanent schema/table/row survives.
- It executes the real `PostgresMcpRevocationBackend` twice with epochs `2000` then `1000` and reads back `2000`.
- A real signed token with `iat == 2000` is rejected through the production revocation comparison using the real PostgreSQL cutoff.
- The test always rolls back and closes, including on assertion failure.

- [ ] **Step 1: Write the integration test against the current backend**

Mark it `@pytest.mark.integration`. Skip only when a real PostgreSQL connection is unavailable; a reachable database plus assertion failure must fail, never skip.

- [ ] **Step 2: Prove it is real and mutation-sensitive**

Load `/home/hein/Workspace/Cortex/.env` into only the test process without printing values. Run:

```bash
python3 -m pytest tests/test_mcp_revocation_postgres.py -m integration -q -rs
```

Require a PASS, not a skip, on the Velo development host. Temporarily replace `GREATEST(...)` with `EXCLUDED.min_iat`; the integration test must fail. Restore and pass.

- [ ] **Step 3: Retain the fast unit and signed-route suite**

```bash
python3 -m pytest tests/test_mcp_revocation.py tests/test_mcp_revoke_route.py -q
```

- [ ] **Step 4: Commit Cortex Task 12**

```text
test(mcp): prove revocation against postgres
```

---

### Task 13: Deploy and verify the hardened Agent Executor through the supported path

**Cortex files:**

- Modify `infra/systemd/cortex-agent-executor.service`
- Modify `scripts/deploy_bridge.sh`
- Modify `scripts/deploy-local.sh`
- Create `tests/test_executor_deploy_contract.py`

**FibreFlow documentation:**

- Modify `docs/superpowers/plans/2026-07-30-cortex-mcp-fibreflow-consent.md`
- Modify `docs/superpowers/specs/2026-07-30-cortex-mcp-fibreflow-consent-design.md`
- Modify `docs/superpowers/specs/2026-07-31-cortex-mcp-informed-consent-addendum-design.md`
- Modify `docs/superpowers/specs/2026-08-01-cortex-mcp-token-lifetime-policy-design.md`
- Modify `docs/superpowers/plans/2026-08-01-cortex-mcp-token-security-remediation.md`

**Interfaces:**

- The executor service runs code from the deploy clone `/home/hein/Workspace/Cortex-bridge/apps/agent_executor`, not the shared development checkout.
- `deploy_bridge.sh` includes `cortex-agent-executor`, restarts/verifies it before Bridge and Remote MCP, proves its process CWD equals the deploy clone, proves PID freshness/stability, and requires `GET http://127.0.0.1:7406/health` success when the executor unit is in scope.
- `deploy-local.sh` restarts and health-checks the executor before starting Bridge, or fails loud. It must not report a safe MCP deployment while leaving the executor stale.
- Verification-only mode performs no restart.
- Isolated DEV proof uses an isolated executor port (for example `17406`) and points the isolated Bridge `EXECUTOR_URL` at it; it never calls production `7406`.
- Rollout order is Cortex Agent Executor, Cortex Bridge/Remote MCP, then FibreFlow UI/proxy. Rollback reverses exposure first.
- The docs state that the outer Cortex OAuth refresh grant expires after 30 days and requires browser reauthorization then, even though the underlying normal Cortex bearer is minted with a 90-day claim.

- [ ] **Step 1: Add static/declarative RED tests**

The test reads the real service unit and deploy scripts and asserts:

- executor `WorkingDirectory` is below `Cortex-bridge`;
- executor is present before Bridge in the default restart list;
- deploy verification checks port `7406` health;
- local deploy restarts/health-checks executor before Bridge;
- no supported rollout command can claim success without executor verification.

Expected RED: current unit points at `/home/hein/Workspace/Cortex`, and both scripts omit executor deployment/health.

- [ ] **Step 2: Implement the supported executor-first path**

Keep existing business-hours/approval gates. Do not add manual pull/reset behavior. Preserve `--units` semantics: executor health is required only when that unit is selected. Keep all service control through `systemctl --user`; never use `pkill`.

- [ ] **Step 3: Reconcile the coordinated rollout documents**

Remove FibreFlow-first instructions. Name the isolated executor process/store/public-base requirements, the executor-first activation sequence, hash-only secret/key checks, complete allowlist readback, and the 30-day outer-grant reauthorization behavior.

- [ ] **Step 4: Verify without restarting services**

```bash
python3 -m pytest tests/test_executor_deploy_contract.py -q
bash -n scripts/deploy_bridge.sh scripts/deploy-local.sh
bash scripts/deploy_bridge.sh --verify-only --units cortex-agent-executor,cortex-bridge
```

The final verify-only command may report current deployment skew because nothing is deployed; record it accurately. It must perform no restart or clone update.

- [ ] **Step 5: Commit repository changes separately**

Cortex:

```text
fix(deploy): activate executor security with bridge
```

FibreFlow docs:

```text
docs(cortex): require executor-first rollout
```

---

### Task 14: Re-run coordinated gates and blind review at frozen heads

**Files:** Verify only in both worktrees.

- [ ] **Step 1: Refresh target ancestry before verification**

Fetch/prune both repositories. Integrate a moved target with a normal merge commit; never rewrite history. Rerun every invalidated gate after a merge.

- [ ] **Step 2: Run focused Cortex security gates**

```bash
python3 -m pytest tests/test_mcp_read_routes_no_writes.py tests/test_query_route_acl.py tests/test_timeline_route.py tests/test_answer_route.py tests/test_answer_metric_route.py tests/test_mcp_access.py tests/test_cortex_mcp.py tests/test_mcp_revocation.py tests/test_mcp_revoke_route.py -q
python3 -m pytest tests/test_mcp_revocation_postgres.py -m integration -q -rs
bun test apps/agent_executor/src
bun x tsc --noEmit --project apps/agent_executor/tsconfig.json
bash scripts/ci/run-ci.sh
```

If Task 9 extends existing test files instead of creating `test_mcp_read_routes_no_writes.py`, omit only that nonexistent path and list the exact real files used.

- [ ] **Step 3: Run focused FibreFlow and repository gates**

Run the complete lifetime/API/proxy/UI/page Vitest set, `npm run ci:quick`, `npm run antihall`, and the environment-complete read-only production build. Continue to disclose the missing-validator baseline unless the refreshed target actually supplies it.

- [ ] **Step 4: Obtain real browser evidence without identity fabrication**

Use a valid pre-existing FibreFlow authenticated state, or obtain explicit approval for a normal login that creates a session and updates `last_login`. Do not forge/extend a JWT. Run only the isolated local visibility test and do not mint/revoke Hein or Lew tokens.

- [ ] **Step 5: Freeze and blind-review exact diffs**

Require fresh independent FibreFlow, Cortex, and cross-repository reviews. Include the real PostgreSQL pass and the executor deployment contract. Any finding reopens the relevant task.

- [ ] **Step 6: Publish coordinated draft PRs only after approval**

Push without force, open cross-linked draft PRs, and state Cortex executor/Bridge enforcement must merge and deploy before FibreFlow exposure. Disclose the Playwright/auth gate and unchanged `antihall` blocker exactly. Stop before merge or deployment.
