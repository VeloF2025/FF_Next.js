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
- Cortex remains tenant-scoped and read-only: query/timeline/meeting retrieval stays
  per-user ACL-filtered, while derived stores without per-user provenance are
  restricted to verified full-tenant principals.

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

Every other method/path pair is denied with a generic 403 before its route handler
executes. A deny-only Cortex pre-routing filter recognizes the marked-token policy
only to reject disallowed framework near misses such as unknown paths, trailing-slash
variants, and unsupported methods. It never grants access or supplies identity.
Matched handlers still use verified `require_auth`, which remains authoritative for
signature, issuer, tenant, session identity, revocation, and route-policy decisions.
The FibreFlow bridge proxy mirrors the same matrix as defense in depth; Cortex remains
the authoritative enforcement point for direct bridge access.

For marked MCP tokens, `POST /api/answer` uses a dedicated read-only synthesis mode
for every decomposition, synthesis, and critique call. That mode has no Agent SDK
tools, MCP servers, setting sources, session persistence, permission bypass, or
transcript sink, and is limited to one turn. The ordinary non-MCP answer behavior is
unchanged.

The facts and entity-profile stores do not retain enough source provenance to apply
per-user ACLs safely. Marked MCP access to those derived stores therefore requires a
verified service or configured super-admin full-tenant principal (including the
preserved `CORTEX_SUPER_ADMIN_EMAILS` entries); ordinary/channel-scoped principals
receive the same generic 403 before any store lookup.

Revocation changes from `iat < min_iat` to conservative `iat <= min_iat`. A token
minted in the same second as the cutoff is rejected. Repeated or out-of-order revoke
writes are monotonic: the in-memory store retains the maximum epoch and PostgreSQL
uses `GREATEST(existing, incoming)`. A newly minted token may need the next JWT second
to become usable; that is preferable to falsely reporting a still-valid indefinite
bearer as revoked.

## Task 1: Harden the FibreFlow boundary with TDD

**Files:**

- Modify `src/lib/cortex/bridgeAuth.ts` and its real-crypto tests to emit `scope: "cortex.read"`.
- Modify `pages/api/cortex/mcp-token.ts` and its handler tests so explicit `null` is rejected while absent/`undefined` still defaults to `30d`.
- Modify `pages/api/cortex-bridge/[...path].ts` and its tests to replace broad prefixes/methods with the exact matrix above.
- Split the panel coverage into `src/components/connections/__tests__/FibreFlowConnectionPanel.test.tsx` and `src/components/connections/__tests__/CortexConnectionPanel.test.tsx` so every source/test file remains below 300 lines.

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

- Create `plugins/memory/cortex/mcp_access.py` for the exact method/path policy and
  deny-only unverified marker detection.
- Modify `apps/bridge/main.py` to apply the deny-only filter before framework routing,
  while preserving verified `require_auth` as the only granting and identity source.
- Modify the answer route/executor boundary to select isolated read-only synthesis for
  every marked-token stage and suppress transcript persistence.
- Add a full-tenant-scope guard before facts/entity derived-store access.
- Add focused policy and real signed-JWT integration tests under `tests/`, plus real
  executor-policy tests.

**RED:**

Use a real HS256 marked bearer against the real FastAPI app. Prove that framework
near misses currently escape post-routing policy, that answer stages currently select
write-capable Agent SDK defaults, and that ordinary principals can currently reach
tenant-wide facts/entity stores. Include at least:

- `POST /api/meetings/intake`;
- `POST /api/meetings/{id}/process`;
- `POST /api/meetings/{id}/classify`;
- `POST /api/meetings/{id}/legal-hold`;
- an unknown path, a trailing-slash variant, `DELETE /api/query`, and
  `POST /api/facts`; and
- a signed marked-token call through the real answer route and all three real answer
  stage functions to a capturing executor boundary.

The test may isolate external stores and services narrowly, but must use the
production JWT verifier, production auth dependency, production MCP policy, real
route/stage functions, and real token signatures. Do not mock the policy or answer
mode selection under test.

**GREEN:**

- All listed mutations and framework near misses return generic 403 for marked MCP
  tokens before route execution.
- The exact read matrix succeeds only through verified `require_auth`.
- `POST /api/answer` reaches only isolated read-only synthesis, while
  `POST /api/mcp-tokens/revoke` remains the sole mutation.
- Facts/entity access succeeds for verified service/super-admin full-tenant
  principals and fails generically for ordinary/channel-scoped principals before
  storage access.
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
- The real-PostgreSQL gate uses a disposable `pg_temp.mcp_token_revocation` table,
  proves out-of-order writes retain the greater cutoff, and rejects a signed token
  whose `iat` equals that cutoff through production authentication. It must pass,
  not skip, on the Velo development host and fail when `GREATEST` is replaced by an
  overwrite.

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
- `python3 -m pytest tests/test_mcp_revocation_postgres.py -m integration -q -rs`
  with the repository's normal PostgreSQL environment loaded process-only; require
  a pass rather than a skip.
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
