# Cortex MCP Token Security Remediation Plan

> **Status:** Required by final independent review before either coordinated PR may be published.
>
> **Repositories:** FibreFlow and Cortex
>
> **Deployment:** Out of scope. No live configuration, restart, merge, or deployment is authorized by this plan.

## Objective

Close the final-review blockers without changing the approved product behavior:

- normal Cortex browser OAuth remains fixed at 90 days;
- Advanced manual tokens may be 30 days, 90 days, 1 year, or indefinite;
- every marked Cortex MCP bearer is server-enforced read-only;
- revoke-all cannot leave an equal-second token valid;
- the public FibreFlow bridge proxy exposes only the exact read operations used by Cortex MCP plus self-revoke;
- identity remains derived only from the verified FibreFlow session;
- Cortex remains tenant-scoped, per-user ACL-filtered, and read-only.

## Enforcement contract

`token_use="mcp"` is the compatibility-safe server marker for the MCP read-only policy. New FibreFlow tokens also carry `scope="cortex.read"` as explicit metadata, but Cortex enforces read-only behavior for every marked MCP token, including already-issued tokens that predate the scope claim.

The Cortex Bridge admits marked tokens only for this exact matrix:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/query` | ACL-filtered retrieval |
| `POST` | `/api/answer` | Semantically read-only grounded answer |
| `GET` | `/api/timeline` | Timeline retrieval |
| `GET` | `/api/facts` or `/api/facts/{fact_id}` | Compiled-fact retrieval |
| `GET` | `/api/entity-profile` | Entity retrieval |
| `GET` | `/api/meetings/{meeting_id}` | Meeting metadata retrieval |
| `GET` | `/api/meetings/{meeting_id}/pack` | Meeting evidence-pack retrieval |
| `POST` | `/api/mcp-tokens/revoke` | The sole mutation: revoke the verified caller's own MCP tokens |

Every other method/path pair is denied with a generic 403 before its route handler executes. The FibreFlow bridge proxy mirrors the same matrix as defense in depth; Cortex remains the authoritative enforcement point for direct bridge access.

Revocation changes from `iat < min_iat` to conservative `iat <= min_iat`. A token minted in the same second as the cutoff is rejected. A newly minted token may need the next JWT second to become usable; that is preferable to falsely reporting a still-valid indefinite bearer as revoked.

## Task 1: Harden the FibreFlow boundary with TDD

**Files:**

- Modify `src/lib/cortex/bridgeAuth.ts` and its real-crypto tests to emit `scope: "cortex.read"`.
- Modify `pages/api/cortex/mcp-token.ts` and its handler tests so explicit `null` is rejected while absent/`undefined` still defaults to `30d`.
- Modify `pages/api/cortex-bridge/[...path].ts` and its tests to replace broad prefixes/methods with the exact matrix above.
- Split `src/components/connections/__tests__/ConnectionPanels.test.tsx` into scoped FibreFlow and Cortex files so every source/test file remains below 300 lines.

**RED:**

1. Add route tests showing `{ lifetime: null }` currently returns 200.
2. Add proxy tests showing meeting intake/process/classify/legal-hold and arbitrary POST/PUT/PATCH/DELETE currently pass the local proxy gate.
3. Add real-token assertion showing the signed payload lacks `scope: "cortex.read"`.
4. Add a line-count assertion or split first and show the original file exceeds the repository limit.

**GREEN:**

- Focused Vitest for signer, token route, proxy route, and both split panel suites.
- Existing normal consent test still proves the exact `90d` signer call.
- `git diff --check` and scoped ESLint pass.

Commit: `fix(cortex): harden manual MCP token boundary`

## Task 2: Enforce read-only MCP access in Cortex with TDD

**Files:**

- Create `plugins/memory/cortex/mcp_access.py` for the exact method/path policy.
- Modify `apps/bridge/auth.py` to enforce that policy after signature, tenant, identity, and revocation verification but before route execution.
- Add focused policy and real signed-JWT integration tests under `tests/`.

**RED:**

Use a real HS256 marked bearer against a real FastAPI route harness. Prove that the current auth layer admits at least:

- `POST /api/meetings/intake`;
- `POST /api/meetings/{id}/process`;
- `POST /api/meetings/{id}/classify`;
- `POST /api/meetings/{id}/legal-hold`.

The test harness may replace tenant/database boundaries, but must use the production JWT verifier, production auth dependency, production MCP access policy, and real token signatures. Do not mock the policy under test.

**GREEN:**

- All listed mutations and all unlisted paths return generic 403 for marked MCP tokens.
- The exact read matrix succeeds through the auth dependency.
- `POST /api/answer` and `POST /api/mcp-tokens/revoke` remain allowed.
- Unmarked FibreFlow session JWTs keep their existing behavior.

Commit: `fix(mcp): enforce read-only bearer scope`

## Task 3: Make Cortex revocation equal-second safe with TDD

**Files:**

- Modify `plugins/memory/cortex/mcp_revocation.py` and its documentation.
- Modify `apps/bridge/routes/mcp_tokens.py` documentation if needed.
- Modify `tests/test_mcp_revocation.py` and `tests/test_mcp_revoke_route.py`.

**RED:**

- Change the equality expectation first: `iat == min_iat` must be rejected.
- Add a real signed-token flow proving a bearer minted at the cutoff fails authentication after immediate revoke.

**GREEN:**

- `iat <= min_iat` returns 401; `iat > min_iat` succeeds.
- Revocation still acts only on the verified caller's normalized email and tenant.
- Unmarked session/API/channel/OIDC credentials remain outside the MCP epoch check.

Commit: `fix(mcp): close equal-second revocation gap`

## Task 4: Coordinated verification and independent review

Run independently and record every exit code.

**FibreFlow:**

- Complete focused Cortex lifetime/API/proxy/UI/page Vitest suite.
- `npm run ci:quick`.
- `npm run antihall` (report the verified missing-validator baseline accurately).
- Environment-complete `npm run build` with the primary checkout environment loaded process-only and PostgreSQL forced read-only.
- `git diff origin/master...HEAD --check`, stat, and clean status.

**Cortex:**

- Focused Pytest for MCP access, auth integration, revocation, revoke route, and Cortex MCP tools.
- `bash scripts/ci/run-ci.sh`.
- Agent-doc mirror checks if any instruction file changes (none planned).
- `git diff origin/main...HEAD --check`, stat, and clean status.

Request fresh independent reviews for each repository and one final cross-repository review. Fix every Critical and Important finding through test-first implementer/reviewer rounds.

## Task 5: Publish coordinated draft PRs and stop

Only after both final reviews approve:

1. Push the FibreFlow branch and open a draft PR against `master`.
2. Push the Cortex branch and open a draft PR against `main`.
3. Cross-link the PRs and state the safe rollout order: Cortex enforcement first, then FibreFlow manual-token UI.
4. State exact verification results and the known `antihall` baseline failure.
5. State explicitly that nothing was deployed and no live configuration changed.

Do not merge or deploy. After review and explicit rollout approval, deploy Cortex enforcement to dev first, prove negative mutation attempts and immediate revoke with a dedicated test identity, then deploy FibreFlow to dev and run the visibility-only Playwright flow. Production remains a separate explicit approval gate.
