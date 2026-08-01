# Cortex MCP Final Blind-Review Remediation Plan

> **Execution rule:** follow strict TDD and the subagent-driven workflow. One implementer owns each task, then a different reviewer inspects the exact commit range. No push, login, deployment, service restart, environment edit, allowlist mutation, or token mint/revoke is part of this plan.

**Goal:** Close the two Important source defects found by the final independent Cortex security review, correct the stale operator guide, rerun the invalidated gates, and obtain a clean final blind review before publishing the coordinated draft PRs.

**Architecture:** Keep FibreFlow as the verified identity and consent authority. Cortex may complete an OAuth grant only when the submitted underlying bearer satisfies two independent conditions: Bridge accepts its signature/tenant/expiry and the unchanged signed claims carry `token_use="mcp"`. Keep the manual approval route unlinked, but impose the same compound validator. Make the legacy `deploy-local.sh` fail before mutation unless its source root and executor deploy clone are the same checkout, then prove the restarted executor process uses that checkout and is fresh/stable before Bridge starts. Do not add automatic pull/reset behavior.

**Frozen starting heads:**

- Cortex: `5e6d5c32bb6ebf2e8a8f54e8f340d5a5a124b82b`
- FibreFlow: `5cd793db6b314cdfda24707083fd3063568c6588`
- Cortex target: `origin/main` at `6cc8f7ce00e7cf5e27ba7411879339a46bd33d00`
- FibreFlow target: `origin/master` at `4e578ac73db50196260054dd01ffa2e4c0dda845`

---

## Task 15A: Require a marked underlying bearer on both authorization paths

**Cortex files:**

- Modify `apps/cortex_mcp/cortex_mcp_callback.py`
- Modify `apps/cortex_mcp/server.py` only if import/call wiring or operator text must change
- Modify `tests/test_cortex_mcp_callback.py`
- Modify `tests/test_cortex_mcp_callback_transport.py` where successful fixtures need a marked JWT shape
- Modify `tests/test_cortex_mcp_manual_fallback.py`
- Modify `tests/test_cortex_mcp_approve_xss.py` only if successful/malformed fixtures need the marked-token shape

**Required contract:**

1. `validate_cortex_token` succeeds only when:
   - the token is a JWT whose decoded payload is a JSON object with exact `token_use == "mcp"`; and
   - the no-redirect Bridge validation request returns `200` for that same unchanged bearer.
2. A malformed/opaque token and a valid signed but unmarked FibreFlow/Bridge token are rejected before `complete_pending` on both `/authorize/complete` and `/authorize/approve`.
3. Marker decoding is not treated as signature verification. Bridge remains the signature, tenant, expiry, membership, and revocation authority. A forged marked payload must still fail when Bridge rejects the signature.
4. Failure responses remain fixed/generic and never echo the submitted bearer. Pending state stays retryable after rejection.
5. The normal FibreFlow callback still succeeds with its genuinely marked 90-day bearer. The retained manual route remains unlinked and accepts only operator-minted marked MCP bearers.

### Step 1: Write substantive RED security cases

- Generate a real HS256 token with valid Bridge claims but no `token_use` marker.
- Prove that token is accepted by production Bridge authentication under isolated test configuration.
- Submit the exact unchanged token to the automated callback and the manual fallback. Both must fail and leave the pending state/code store unchanged.
- Add an opaque-bearer negative case and a forged-marked-but-Bridge-rejected case.
- Successful callback/transport fixtures may isolate the external HTTP boundary, but the unmarked-token security claim must not rely only on a fake `200` server.

Expected RED: the current callback and manual route consume the pending state whenever Bridge returns `200`, regardless of `token_use`.

### Step 2: Add one shared compound validator

- Decode only the JWT payload needed to require the exact marker.
- Reject malformed payloads, non-object payloads, missing marker, and wrong marker with `ValueError`.
- Then perform the existing no-redirect Bridge validation with the unchanged token.
- Reuse the same function from both authorization paths; do not duplicate the marker policy.
- Do not allowlist unmarked tokens at Bridge and do not change normal Bridge session/API-key/OIDC behavior.

### Step 3: Verify and mutate

Run:

```bash
python3 -m pytest \
  tests/test_cortex_mcp_callback.py \
  tests/test_cortex_mcp_callback_transport.py \
  tests/test_cortex_mcp_manual_fallback.py \
  tests/test_cortex_mcp_approve_xss.py \
  tests/test_cortex_mcp_oauth.py \
  tests/test_cortex_mcp_revocation.py -q
```

Temporarily remove the marker requirement. The signed-unmarked callback and manual-route cases must fail. Restore it. Temporarily skip Bridge validation after the marker check. The forged-marked case must fail. Restore and rerun GREEN.

### Step 4: Commit

```text
fix(mcp): require marked underlying oauth bearer
```

---

## Task 15B: Make legacy local deployment prove executor source and freshness

**Cortex files:**

- Modify `scripts/deploy-local.sh`
- Modify `tests/test_executor_deploy_contract.py`

**Required contract:**

1. Before acquiring the deploy lock or controlling any service, resolve `REPO_ROOT` and `DEPLOY_CLONE` and fail unless they are the same checkout. The supported live checkout is `/home/hein/Workspace/Cortex-bridge` unless explicitly overridden for an isolated proof.
2. Record the deployment start epoch before executor restart.
3. After executor restart and health success, require:
   - a nonzero `MainPID` from `systemctl --user`;
   - `/proc/<pid>/cwd` equals `<DEPLOY_CLONE>/apps/agent_executor`;
   - process start time is at or after the deployment start epoch;
   - the PID remains unchanged across a real stability window.
4. Any source/CWD/freshness/stability failure aborts before Bridge starts and before the script can print deploy success.
5. Preserve the existing lint/business/approval behavior and `systemctl --user` controls. Do not add `git pull`, reset, checkout rewriting, `pkill`, or automatic clone updates.

### Step 1: Add RED contract tests

- Add an executable subprocess test that sets `CORTEX_LIVE_CLONE` to a different temporary checkout and runs the real script. It must fail at the source-root guard before lock creation or service control.
- Add declarative assertions for nonzero PID, exact executor CWD, deploy-start freshness, PID stability, and their ordering before `systemctl --user start cortex-bridge` and the final success banner.
- Assert both source roots' Git HEAD equivalence if the implementation records it explicitly.

Expected RED: current script accepts split roots and proves only HTTP health.

### Step 2: Implement the fail-loud proof

- Keep the checks simple shell functions where reuse improves correctness.
- Run the source-root check before validating deploy artifacts or touching `/tmp/cortex-deploy.lock`.
- Print only safe path/hash prefixes and verdicts; no environment values.

### Step 3: Verify and mutate

Run:

```bash
python3 -m pytest tests/test_executor_deploy_contract.py -q
bash -n scripts/deploy_bridge.sh scripts/deploy-local.sh
```

Temporarily remove the source-root guard, CWD proof, freshness proof, and stability proof one at a time. Each corresponding test must fail. Restore and rerun GREEN. Do not execute `deploy-local.sh` against live services.

The read-only command remains permitted:

```bash
bash scripts/deploy_bridge.sh --verify-only --units cortex-agent-executor,cortex-bridge
```

Record the known undeployed executor skew without changing it.

### Step 4: Commit

```text
fix(deploy): prove executor source in local deploy
```

---

## Task 15C: Correct the Cortex MCP operator guide

**Cortex file:**

- Modify `docs/cortex-mcp-connect.md`

**Required contract:**

- List exactly the eight remote tools:
  - `cortex_query`
  - `cortex_search`
  - `cortex_meeting_get`
  - `cortex_meeting_pack`
  - `cortex_answer`
  - `cortex_timeline`
  - `cortex_facts`
  - `cortex_entity_profile`
- Remove chat/connections/evidence/gap tools from the advertised remote OAuth surface.
- State that `scripts/mint_user_token.py --days` accepts 1 through 3,650 days and `--never` creates a no-expiry token revocable through the MCP epoch. Keep the approved FibreFlow Advanced UI choices as 30 days, 90 days, 1 year, and Never expires.
- Keep the normal workflow as FibreFlow login/consent; token paste remains operator-only rollback guidance.

Verify the guide against the runtime registry exact-set test and the minter argument checks. Commit:

```text
docs(mcp): align connector guide with runtime
```

---

## Task 15D: Re-run invalidated gates and final blind review

### Step 1: Cortex focused and full verification

Run the Task 15A/15B focused suites, then:

```bash
python3 -m pytest \
  tests/test_query_route_acl.py \
  tests/test_timeline_route.py \
  tests/test_answer_route.py \
  tests/test_answer_metric_route.py \
  tests/test_mcp_access.py \
  tests/test_cortex_mcp.py \
  tests/test_mcp_revocation.py \
  tests/test_mcp_revoke_route.py \
  tests/test_executor_deploy_contract.py -q
python3 -m pytest tests/test_mcp_revocation_postgres.py -m integration -q -rs
bun test apps/agent_executor/src
bun x tsc --noEmit --project apps/agent_executor/tsconfig.json
bash scripts/ci/run-ci.sh
git diff --check origin/main...HEAD
```

Require the PostgreSQL test to pass rather than skip on this host. Record the known SDK-isolation limitation honestly: unit/type contracts are strong, but there is no real external SDK invocation proving zero filesystem writes.

### Step 2: FibreFlow documentation-only verification

The only new FibreFlow change is this plan. Run:

```bash
git diff --check origin/master...HEAD
bash scripts/secret-scan.sh
```

Retain the unchanged `npm run antihall` missing-validator blocker and the approval-gated frozen-local Playwright status. Do not repeat already green Vitest/build solely for this plan file.

### Step 3: Fresh blind review

- One fresh Cortex security reviewer inspects the full PR diff and explicitly retests both prior Important findings.
- One fresh coordinated reviewer inspects both repository heads and rollout order.
- Source approval and rollout readiness remain separate. Existing live executor skew, hash-only secret/key readbacks, complete superadmin allowlist preservation plus exact Lew address, isolated OAuth ports/store/public base, credential rotation, browser login, and production deploy remain explicit rollout gates.

### Step 4: Publish only after clean review

- Push both feature branches without force.
- Open cross-linked draft PRs.
- State that Cortex must merge and deploy Executor, Bridge, and Remote MCP before FibreFlow exposure.
- Disclose `antihall`, Playwright/login approval, existing executor skew, and separate credential-rotation findings.
- Stop before merge or deployment.
