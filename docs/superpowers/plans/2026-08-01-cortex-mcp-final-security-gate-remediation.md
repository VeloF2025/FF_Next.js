# Cortex MCP Final Security Gate Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final independent-review findings so every long-lived Cortex MCP bearer remains useful for approved reads, cannot invoke tools or persistence through answer synthesis, cannot expose unresolved tenant-wide derived stores to ordinary users, and cannot be revived by a lower revocation epoch.

**Architecture:** FibreFlow retains the exact public method/path allowlist and Advanced token UI, while Cortex remains the authoritative verified-token enforcement point. Marked MCP answer requests use a distinct executor mode with no built-in tools, MCP servers, filesystem settings, SDK session persistence, or transcript sink; unresolved facts and graph routes admit only the existing full-tenant service/super-admin scope. A deny-only pre-routing filter gives valid marked tokens a generic 403 on framework near misses, while the verified `require_auth` policy remains authoritative for matched handlers.

**Tech Stack:** Next.js Pages Router, React, TypeScript, Vitest, Testing Library, FastAPI, PyJWT, Pytest, Bun, Claude Agent SDK, PostgreSQL.

## Global Constraints

- Normal Cortex browser OAuth stays fixed at `90d`; do not add lifetime selection or token reveal to `/cortex/mcp/authorize`.
- Advanced manual Cortex minting offers exactly `30d`, `90d`, `1y`, and `never` to every authenticated FibreFlow user with `cortex.review:view`.
- There is no special super-admin lifetime ceiling. Preserve every existing `CORTEX_SUPER_ADMIN_EMAILS` entry, including `lew@velocityfibre.co.za` with full Velocity Fibre tenant read scope.
- Identity comes only from the signature-verified FibreFlow session. No request body or unverified header may grant identity, tenant, role, scope, or access.
- Marked Cortex MCP bearers are read-only. Self-revocation is the sole permitted Cortex mutation.
- `/api/answer` for a marked MCP bearer may retrieve ACL-filtered evidence and synthesize text, but may not expose agent tools, MCP servers, filesystem settings, SDK session persistence, or `/api/improvement/observe` transcript persistence.
- `/api/facts` and `/api/entity-profile` remain available to full-tenant service/super-admin principals only until their derived stores have real per-user provenance filtering. Ordinary users fail closed with generic 403.
- `min_iat` is monotonic per `(instance_id, user_email)`. A lower or out-of-order revoke write may never revive an older token.
- FibreFlow and Cortex method/path matrices remain byte-for-byte equivalent after decoded segment validation. Every authenticated FibreFlow non-matrix request returns generic 403 and never reaches `fetch`.
- Use real production functions, signed JWTs, local loopback HTTP, and real FastAPI routing for new security evidence. Do not add mock-only proof.
- Use npm in FibreFlow and the repository CI commands in Cortex. Do not regenerate FibreFlow `bun.lock`.
- No push, PR, merge, deployment, service restart, live environment edit, or live access change occurs until the relevant later gate is explicitly reached.
- Safe rollout order is Cortex enforcement first, then FibreFlow UI/proxy. Production remains a separate explicit approval after dev evidence.

## File Map

### Cortex

- Modify `apps/agent_executor/src/run.ts`: parse the execution mode into an SDK query policy; isolate read-only synthesis from tools, settings, persistence, and MCP servers.
- Modify `apps/agent_executor/src/server.ts`: accept only `agent` or `read_only_synthesis` and reject invented execution modes.
- Modify `apps/agent_executor/src/lib/transcript-sink.ts`: make transcript persistence fail closed for read-only synthesis.
- Create `apps/agent_executor/src/run-policy.test.ts`: test the real production policy builder without replacing the SDK.
- Modify `apps/agent_executor/src/lib/transcript-sink.test.ts`: prove the production sink policy denies read-only synthesis.
- Modify `apps/bridge/brain/text_client.py`: serialize the exact read-only executor contract while keeping direct Anthropic fallback tool-free.
- Modify `apps/bridge/routes/answer.py`: derive read-only synthesis only from verified `token_use="mcp"` claims and propagate it to decomposition, synthesis, and critique.
- Modify `tests/test_text_client.py`: add a real loopback HTTP contract test for the executor payload.
- Modify `tests/test_answer_route.py`: keep existing route tests compatible and prove all answer LLM stages receive the marked-token execution mode.
- Create `apps/bridge/full_tenant_scope.py`: share the full-tenant service/super-admin gate.
- Modify `apps/bridge/routes/facts.py`: enforce the full-tenant gate before storage and describe scope honestly.
- Modify `apps/bridge/routes/entity_profile.py`: enforce the same gate before the feature/store path and describe scope honestly.
- Create `tests/test_full_tenant_scope.py`: test the production gate with real service, ordinary, and configured super-admin principals.
- Modify `tests/test_facts_route.py`: prove ordinary principals are denied before facts storage.
- Modify `tests/test_entity_profile_route.py`: prove ordinary principals are denied before graph storage.
- Modify `plugins/memory/cortex/mcp_access.py`: add the deny-only claimed-marker pre-routing predicate while retaining verified enforcement.
- Modify `apps/bridge/main.py`: run the deny-only filter before FastAPI routing.
- Modify `tests/test_mcp_access.py`: send real signed marked tokens through the real bridge app for 404/405/redirect near misses.
- Modify `plugins/memory/cortex/mcp_revocation.py`: make in-memory and PostgreSQL epoch writes monotonic.
- Modify `plugins/memory/cortex/mcp_revocation_schema.sql`: correct the `iat <= min_iat` contract comment.
- Modify `tests/test_mcp_revocation.py`: prove a lower second write cannot reduce the production in-memory backend cutoff.

### FibreFlow

- Modify `pages/api/cortex-bridge/[...path].ts`: return generic 403 for decoded dot segments.
- Modify `pages/api/cortex-bridge/__tests__/[...path].test.ts`: pin dot-segment parity with every other non-matrix request.
- Modify `src/components/connections/CortexConnectionPanel.tsx`: clear a stale revoke-success notice when minting starts.
- Modify `src/components/connections/__tests__/CortexConnectionPanel.test.tsx`: prove a later mint clears the earlier revoke notice.
- Modify `docs/superpowers/specs/2026-08-01-cortex-mcp-token-lifetime-policy-design.md`: record the coordinated Cortex enforcement requirement and Cortex-first rollout.
- Modify `docs/superpowers/plans/2026-08-01-cortex-mcp-token-lifetimes.md`: replace removed combined-test paths and the stale FibreFlow-only deployment statement.
- Modify `docs/superpowers/plans/2026-08-01-cortex-mcp-token-security-remediation.md`: clarify matched-handler versus pre-routing denial and add safe answer synthesis/full-scope derived-store requirements.

---

### Task 1: Reconcile branch ancestry and freeze the remediation baseline

**Files:**
- Verify only: both repository worktrees

**Interfaces:**
- Consumes FibreFlow `origin/master` and Cortex `origin/main`.
- Produces a Cortex branch containing current `origin/main` without rewriting the published feature branch.

- [ ] **Step 1: Prove both worktrees are clean and named branches**

Run:

```bash
git -C /home/hein/Workspace/FF_Next.js-cortex-token-lifetimes status --short --branch
git -C /home/hein/Workspace/Cortex-mcp-readonly-lifetimes status --short --branch
```

Expected: no path entries; branches are `feat/cortex-mcp-token-lifetimes` and `fix/cortex-mcp-readonly-lifetimes`.

- [ ] **Step 2: Merge current Cortex main without history rewriting**

Run:

```bash
git -C /home/hein/Workspace/Cortex-mcp-readonly-lifetimes fetch --prune origin
git -C /home/hein/Workspace/Cortex-mcp-readonly-lifetimes merge --no-edit origin/main
```

Expected: a clean merge; the six upstream paths do not overlap the existing seven feature paths. Do not rebase or force-push the published branch.

- [ ] **Step 3: Record exact baselines**

Run `git rev-parse HEAD`, `git rev-parse origin/main`, and `git status --short` in Cortex; run the equivalent against `origin/master` in FibreFlow. Put the hashes in the task report, not source files.

---

### Task 2: Isolate marked MCP answer synthesis from tools and persistence

**Files:**
- Modify: `apps/agent_executor/src/run.ts`
- Modify: `apps/agent_executor/src/server.ts`
- Modify: `apps/agent_executor/src/lib/transcript-sink.ts`
- Create: `apps/agent_executor/src/run-policy.test.ts`
- Modify: `apps/agent_executor/src/lib/transcript-sink.test.ts`
- Modify: `apps/bridge/brain/text_client.py`
- Modify: `apps/bridge/routes/answer.py`
- Modify: `tests/test_text_client.py`
- Modify: `tests/test_answer_route.py`

**Interfaces:**
- Produces `ExecutionMode = "agent" | "read_only_synthesis"` and `buildRunPolicy(req)` in the executor.
- `read_only_synthesis` forces `maxTurns: 1`, `permissionMode: "dontAsk"`, `tools: []`, `settingSources: []`, `persistSession: false`, and no `mcpServers`.
- `executor_text(..., read_only=True)` serializes `execution_mode: "read_only_synthesis"`; the default serializes `agent` or omits the field without changing existing callers.
- `answer.py` obtains the boolean exclusively from verified `_auth` claims through `is_mcp_token(_auth)`.

- [ ] **Step 1: Write failing executor policy tests**

Create `run-policy.test.ts` using the real exported builder:

```typescript
import { describe, expect, test } from "bun:test";
import { buildRunPolicy, type RunRequest } from "./run";

const base: RunRequest = { task_id: "t", user_message: "answer" };

test("read-only synthesis disables every tool and persistence surface", () => {
  const policy = buildRunPolicy({ ...base, execution_mode: "read_only_synthesis", max_turns: 25 });
  expect(policy.maxTurns).toBe(1);
  expect(policy.permissionMode).toBe("dontAsk");
  expect(policy.tools).toEqual([]);
  expect(policy.settingSources).toEqual([]);
  expect(policy.persistSession).toBe(false);
  expect(policy.attachMcpServers).toBe(false);
});

test("normal agent execution keeps the existing policy", () => {
  const policy = buildRunPolicy({ ...base, execution_mode: "agent", max_turns: 7 });
  expect(policy.maxTurns).toBe(7);
  expect(policy.permissionMode).toBe("bypassPermissions");
  expect(policy.attachMcpServers).toBe(true);
});
```

Extend the real sink-policy test so `shouldSinkTranscript({ execution_mode: "read_only_synthesis" })` is false and normal agent requests remain true.

- [ ] **Step 2: Verify executor RED**

Run:

```bash
bun test apps/agent_executor/src/run-policy.test.ts apps/agent_executor/src/lib/transcript-sink.test.ts
```

Expected: FAIL because the execution mode and policy functions do not exist.

- [ ] **Step 3: Write failing real-HTTP bridge client proof**

In `tests/test_text_client.py`, start a standard-library `ThreadingHTTPServer` on `127.0.0.1:0`, point `tc.EXECUTOR_URL` at its assigned port, call the real `executor_text("P", read_only=True)`, and assert the captured JSON contains exactly:

```python
assert captured["execution_mode"] == "read_only_synthesis"
assert captured["auth_mode"] == "oauth"
assert captured["max_turns"] == 1
```

The handler returns `{"final_text":"grounded"}` over the real socket. No `urllib` replacement is used in this test.

- [ ] **Step 4: Verify bridge client RED**

Run:

```bash
python3 -m pytest tests/test_text_client.py -q
```

Expected: FAIL because `executor_text` has no `read_only` parameter.

- [ ] **Step 5: Implement the executor mode and fail-closed parser**

Add the exact union type to `RunRequest`; make `parseRunRequest` reject any non-empty value other than `agent` or `read_only_synthesis`. `buildRunPolicy` returns the policy asserted above. In `runTask`, spread the read-only SDK options, omit `mcpWidgets` for read-only mode, and preserve the existing normal-agent options. The pinned SDK contract states that `tools: []` disables all built-in tools, `settingSources: []` disables filesystem settings, and `persistSession: false` disables `~/.claude/projects` writes.

In `transcript-sink.ts`:

```typescript
export function shouldSinkTranscript(req: Pick<RunRequest, "execution_mode">): boolean {
  return req.execution_mode !== "read_only_synthesis";
}

export function sinkTranscript(req: RunRequest, res: RunResponse): void {
  if (!shouldSinkTranscript(req)) return;
  // existing POST remains unchanged
}
```

- [ ] **Step 6: Propagate verified marked-token mode through all answer LLM stages**

Add a defaulted `read_only: bool = False` parameter to `executor_text`, `_executor_run`, `_llm_synthesize`, `_decompose_question`, and `_self_critique`. In the route:

```python
read_only_synthesis = is_mcp_token(_auth or {})
```

Pass that value to decomposition, final synthesis, and critique. Do not read a body field or header for this decision. Keep the direct Anthropic fallback unchanged: it already submits a Messages request with no tools and no Cortex transcript sink.

- [ ] **Step 7: Verify GREEN and compile**

Run:

```bash
bun test apps/agent_executor/src/run-policy.test.ts apps/agent_executor/src/lib/transcript-sink.test.ts
bun x tsc --noEmit --project apps/agent_executor/tsconfig.json
python3 -m pytest tests/test_text_client.py tests/test_answer_route.py -q
```

Expected: every command exits 0; the loopback HTTP test captures `read_only_synthesis`, and the executor policy exposes no tools or persistence surface.

- [ ] **Step 8: Commit Task 2**

Stage only the Task 2 Cortex files and commit:

```bash
git commit -m "fix(mcp): isolate read-only answer synthesis"
```

---

### Task 3: Deny framework near misses before routing while retaining verified enforcement

**Files:**
- Modify: `plugins/memory/cortex/mcp_access.py`
- Modify: `apps/bridge/main.py`
- Modify: `tests/test_mcp_access.py`

**Interfaces:**
- Produces `claims_mcp_marker(authorization: str | None) -> bool`, a deny-only unverified marker parser that never grants access.
- `require_auth` continues to verify the signature, identity, tenant, revocation epoch, and authoritative route policy before a matched handler.
- The main middleware returns `JSONResponse(status_code=403, content={"detail":"Forbidden"})` before FastAPI routing whenever a bearer declares `token_use="mcp"` and its method/path is outside the exact matrix.

- [ ] **Step 1: Write real-app failing near-miss tests**

Use a real HS256-signed marked JWT and `apps.bridge.main.app`. Assert generic 403 for:

```python
(
    ("GET", "/api/not-a-route"),
    ("DELETE", "/api/query"),
    ("GET", "/api/query/"),
    ("POST", "/api/facts"),
)
```

Also send an unmarked signed session token to `/api/not-a-route` and assert the existing framework 404 remains unchanged. These tests use real routing and no dependency overrides because the marked near misses are denied before authentication/routing.

- [ ] **Step 2: Verify RED**

Run `python3 -m pytest tests/test_mcp_access.py -q`.

Expected: at least unknown/trailing-slash cases return 404/307 instead of generic 403.

- [ ] **Step 3: Implement the deny-only prefilter**

Decode only enough JWT payload to detect a claimed marker, with signature and expiry verification disabled. Any missing/malformed/non-JWT bearer returns false and continues to normal authentication. Document explicitly that this predicate can only deny; it never supplies claims, identity, or authorization. Register the middleware in `apps/bridge/main.py` and call the existing `is_mcp_request_allowed` matrix.

- [ ] **Step 4: Verify GREEN and matched-route regression**

Run:

```bash
python3 -m pytest tests/test_mcp_access.py tests/test_mcp_revocation.py -q
```

Expected: all near misses are generic 403, matched allowed routes still reach verified auth, and unmarked traffic retains prior routing behavior.

- [ ] **Step 5: Commit Task 3**

Commit only the three Task 3 files with `fix(mcp): deny marked route near misses`.

---

### Task 4: Fail closed on unresolved facts and entity graph ACLs

**Files:**
- Create: `apps/bridge/full_tenant_scope.py`
- Modify: `apps/bridge/routes/facts.py`
- Modify: `apps/bridge/routes/entity_profile.py`
- Create: `tests/test_full_tenant_scope.py`
- Modify: `tests/test_facts_route.py`
- Modify: `tests/test_entity_profile_route.py`

**Interfaces:**
- Produces `require_full_tenant_scope(request, claims) -> None`.
- The helper delegates to the existing `resolve_principal_access`; `None` means full tenant scope for a service credential or configured super-admin, while any `ChannelAccess` means deny.
- Both derived-store routes call the helper before feature gates or storage.

- [ ] **Step 1: Write failing production-helper tests without storage mocks**

Create requests with real `request.state.instance` objects and assert:

```python
require_full_tenant_scope(service_request, {"sub": "api-key"})  # no exception

with pytest.raises(HTTPException) as exc:
    require_full_tenant_scope(ordinary_request_without_tenant, {"sub": "user"})
assert exc.value.status_code == 403
assert exc.value.detail == "Forbidden"
```

Configure `CORTEX_SUPER_ADMIN_EMAILS` with both Hein and Lew using the existing module-reload pattern and assert both resolve to `None`; assert an ordinary address resolves to `ChannelAccess`.

- [ ] **Step 2: Write failing route-order tests**

For `/api/facts`, `/api/facts/{id}`, and `/api/entity-profile`, use the existing route test app with an ordinary verified user. Assert 403 and assert the existing storage seam has zero calls. This is route wiring evidence layered on the real policy tests, not the sole security proof.

- [ ] **Step 3: Verify RED**

Run:

```bash
python3 -m pytest tests/test_full_tenant_scope.py tests/test_facts_route.py tests/test_entity_profile_route.py -q
```

Expected: ordinary route calls currently return data because no full-scope gate exists.

- [ ] **Step 4: Implement and document the full-scope gate**

The helper raises generic 403 for every non-`None` access object. Call it immediately after `require_auth` completes and before `_query_facts`, `_query_fact_by_id`, `_require_enabled`, or `_query_entity_profile`. Change response metadata to `user_acl: "full_tenant_scope_only"`; keep `graph_acl_resolved: false` honest on entity profiles.

- [ ] **Step 5: Verify GREEN plus super-admin regression**

Run:

```bash
python3 -m pytest tests/test_full_tenant_scope.py tests/test_superadmin_bypass.py tests/test_facts_route.py tests/test_entity_profile_route.py tests/test_cortex_mcp.py -q
```

Expected: ordinary users are denied before storage; service credentials and configured Hein/Lew principals preserve full tenant read scope.

- [ ] **Step 6: Commit Task 4**

Commit Task 4 files with `fix(mcp): gate unresolved derived stores`.

---

### Task 5: Make revocation epochs monotonic

**Files:**
- Modify: `plugins/memory/cortex/mcp_revocation.py`
- Modify: `plugins/memory/cortex/mcp_revocation_schema.sql`
- Modify: `tests/test_mcp_revocation.py`

**Interfaces:**
- `set_min_iat(instance_id, user_email, new_epoch)` preserves the greater of the existing and new epoch.
- PostgreSQL performs the comparison atomically inside `ON CONFLICT`.

- [ ] **Step 1: Write the failing out-of-order regression**

```python
def test_lower_out_of_order_write_never_reduces_cutoff():
    backend = InMemoryMcpRevocationBackend()
    backend.set_min_iat("velocity-fibre", "u@x.co", 2000)
    backend.set_min_iat("velocity-fibre", "u@x.co", 1000)
    assert backend.get_min_iat("velocity-fibre", "u@x.co") == 2000
```

- [ ] **Step 2: Verify RED**

Run `python3 -m pytest tests/test_mcp_revocation.py::TestInMemoryBackend -q`.

Expected: the lower write currently reduces the cutoff to 1000.

- [ ] **Step 3: Implement atomic monotonic writes**

Use `max(existing, int(min_iat))` in the in-memory backend. Change the PostgreSQL conflict clause to:

```sql
min_iat = GREATEST(mcp_token_revocation.min_iat, EXCLUDED.min_iat)
```

Correct the schema comment to `iat <= min_iat`.

- [ ] **Step 4: Verify GREEN and real signed revoke proof**

Run:

```bash
python3 -m pytest tests/test_mcp_revocation.py tests/test_mcp_revoke_route.py -q
```

Expected: all pass, including the existing real signed immediate-revoke route proof.

- [ ] **Step 5: Commit Task 5**

Commit Task 5 files with `fix(mcp): keep revocation epochs monotonic`.

---

### Task 6: Restore FibreFlow proxy/UI consistency and make the committed docs true

**Files:**
- Modify: `pages/api/cortex-bridge/[...path].ts`
- Modify: `pages/api/cortex-bridge/__tests__/[...path].test.ts`
- Modify: `src/components/connections/CortexConnectionPanel.tsx`
- Modify: `src/components/connections/__tests__/CortexConnectionPanel.test.tsx`
- Modify: `docs/superpowers/specs/2026-08-01-cortex-mcp-token-lifetime-policy-design.md`
- Modify: `docs/superpowers/plans/2026-08-01-cortex-mcp-token-lifetimes.md`
- Modify: `docs/superpowers/plans/2026-08-01-cortex-mcp-token-security-remediation.md`

**Interfaces:**
- Every bearer-authenticated FibreFlow non-matrix path returns the same generic 403.
- A successful revoke notice exists only until the next mint begins.
- Committed design and plans state the mandatory coordinated Cortex-first rollout.

- [ ] **Step 1: Change tests first**

Change the decoded dot-segment expectation from 404 to 403. Add a UI test that successfully revokes, confirms the status notice, starts a later mint, and asserts the old notice is absent before the mint resolves.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run 'pages/api/cortex-bridge/__tests__/[...path].test.ts' src/components/connections/__tests__/CortexConnectionPanel.test.tsx
```

Expected: dot segments return 404 and the stale revoke notice remains visible.

- [ ] **Step 3: Implement the two surgical fixes**

Return `apiResponse.forbidden(res, 'Cortex Bridge request is not permitted')` for decoded `.` or `..`. At the start of `generate`, call `setNotice(null)` before issuing the request.

- [ ] **Step 4: Reconcile committed documentation**

In the approved design, replace “No Cortex repository change is required” with the authoritative Cortex read-only enforcement requirement. State that Cortex enforcement must deploy and pass negative tests before FibreFlow UI/proxy. In the original plan, replace every removed `ConnectionPanels.test.tsx` reference with the split Cortex/FibreFlow files and replace FibreFlow-only PR/deploy language with coordinated PRs. In the security plan, state that the deny-only pre-routing filter covers framework near misses while verified `require_auth` remains authoritative, and add the safe-answer/full-scope derived-store constraints.

- [ ] **Step 5: Verify GREEN and scan stale claims**

Run:

```bash
npx vitest run 'pages/api/cortex-bridge/__tests__/[...path].test.ts' src/components/connections/__tests__/CortexConnectionPanel.test.tsx
rg -n 'No Cortex repository change|ConnectionPanels\.test|FibreFlow-only|FibreFlow first' docs/superpowers/specs/2026-08-01-cortex-mcp-token-lifetime-policy-design.md docs/superpowers/plans/2026-08-01-cortex-mcp-token-lifetimes.md docs/superpowers/plans/2026-08-01-cortex-mcp-token-security-remediation.md
```

Expected: focused tests pass and `rg` returns no stale claim.

- [ ] **Step 6: Commit Task 6**

Commit the seven FibreFlow files with `fix(cortex): close final MCP review gaps`.

---

### Task 7: Run coordinated verification and fresh independent review

**Files:**
- Verify only: both worktrees and frozen diffs

**Interfaces:**
- Produces exact per-repository evidence and fresh independent approval at the final heads.
- Does not push, open PRs, merge, deploy, restart services, or modify live configuration.

- [ ] **Step 1: Run focused Cortex verification**

```bash
python3 -m pytest tests/test_text_client.py tests/test_answer_route.py tests/test_mcp_access.py tests/test_full_tenant_scope.py tests/test_superadmin_bypass.py tests/test_facts_route.py tests/test_entity_profile_route.py tests/test_mcp_revocation.py tests/test_mcp_revoke_route.py tests/test_cortex_mcp.py -q
bun test apps/agent_executor/src
bun x tsc --noEmit --project apps/agent_executor/tsconfig.json
```

- [ ] **Step 2: Run full Cortex CI**

Run `bash scripts/ci/run-ci.sh` and capture its final exit code and all gate results.

- [ ] **Step 3: Run focused FibreFlow verification**

Run the complete lifetime/API/proxy/UI/page Vitest set from the prior security plan, including the split Cortex and FibreFlow panel tests.

- [ ] **Step 4: Run FibreFlow repository gates**

Run:

```bash
npm run ci:quick
npm run antihall
```

If `antihall` still fails only because `scripts/antihall-validator.cjs` is absent on both base and head, report it as an unchanged repository blocker; do not call it passing.

- [ ] **Step 5: Run a process-only production build**

Build with the established primary `.env.local` plus `PGOPTIONS='-c default_transaction_read_only=on'`. Confirm exit 0 and do not write shared DB state.

- [ ] **Step 6: Run Playwright without minting live indefinite credentials**

Run the isolated local `/connections/cortex` visibility flow. Open Advanced and verify the exact four lifetime labels, Generate, and Revoke. Do not create or revoke Hein/Lew live credentials.

- [ ] **Step 7: Freeze final diffs and dispatch blind reviews**

Freeze `origin/master...<FF_HEAD>` and `origin/main...<CORTEX_HEAD>` diffs. Give fresh reviewers only the final diffs, committed designs/plans, and repository instructions. Require:

1. independent FibreFlow review;
2. independent Cortex review;
3. independent cross-repository security review.

Any finding reopens the relevant TDD task. Approval applies only to the exact reviewed heads.

---

### Task 8: Publish coordinated draft PRs after approval

**Files:**
- GitHub metadata only

**Interfaces:**
- Produces two cross-linked draft PRs with Cortex-first rollout instructions.
- Does not merge or deploy.

- [ ] **Step 1: Recheck remote ancestry and CI evidence**

Fetch both remotes, confirm neither feature branch is behind its target, and rerun any check invalidated by an intervening target-branch change.

- [ ] **Step 2: Push without history rewriting**

Use `gh`/normal git push. Never force-push. If the remote branch advanced externally, stop and integrate it before pushing.

- [ ] **Step 3: Open and cross-link draft PRs**

The Cortex PR states that it must deploy first. The FibreFlow PR states that it is blocked on the Cortex enforcement PR. Both bodies list exact verification results, disclose the unchanged `antihall` blocker if still present, and state that nothing was deployed or changed in live configuration.

- [ ] **Step 4: Hold rollout gates**

Do not merge or deploy. After review and explicit rollout approval, deploy Cortex to dev first; prove tool-free/non-persisting answer behavior, full-scope facts/entity behavior for the dedicated authorized test identity, negative mutation/near-miss requests, monotonic revoke, and a real connector journey. Only then deploy FibreFlow to dev and run browser UI plus real connector evidence. Production requires a separate explicit approval and follows the same order.
