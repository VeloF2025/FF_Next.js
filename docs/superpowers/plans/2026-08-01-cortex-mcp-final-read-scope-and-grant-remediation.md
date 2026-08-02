# Cortex MCP Final Read-Scope and Persisted-Grant Remediation Plan

> **Execution rule:** use strict TDD and the subagent-driven workflow. One implementer owns each task; a different reviewer inspects the exact commit range. Do not push, deploy, restart services, edit an environment, log in, mint/revoke a live token, or change a live allowlist while executing this plan.

**Goal:** Close the two Important defects found by the fresh full-PR security and coordinated reviews: configured Cortex super-admins do not receive full-tenant meeting reads, and unsafe unmarked underlying bearers in pre-existing outer OAuth grants survive the new-issuance fix.

**Architecture:** Keep verified FibreFlow/Cortex identity and the existing `CORTEX_SUPER_ADMIN_EMAILS` policy as the source of full-tenant read authority. Represent meeting full-tenant read separately from meeting administration so it can unlock GET metadata/packs, including restricted meetings, without unlocking classify, legal-hold, process, or other writes. Move the exact unverified `token_use="mcp"` shape precondition into a shared pure helper. Apply it at OAuth issuance, stored access loading, stored refresh loading/exchange, and outer-OAuth credential use; Bridge remains the signature, tenant, expiry, membership, and revocation authority. Unsafe unmarked stored grants fail closed and require re-consent. Stdio/environment/channel-key fallback remains separate.

**Frozen starting heads:**

- Cortex: `efdf20fb86d9c8f8542147f133e32e71ce8adb3f`
- FibreFlow: `b686c66d72e0354c34a3e885927facaab95a7cae`
- Cortex target: `origin/main` at `6cc8f7ce00e7cf5e27ba7411879339a46bd33d00`
- FibreFlow target: `origin/master` at `4e578ac73db50196260054dd01ffa2e4c0dda845`

## Locked decisions

1. `lew@velocityfibre.co.za` and every other configured `CORTEX_SUPER_ADMIN_EMAILS` entry receive full read scope inside their verified tenant, including `cortex_meeting_get` and `cortex_meeting_pack`.
2. Full-tenant read is not meeting administration. It must not make `_require_admin` pass or enable classify, legal-hold, process, intake, action mutation, delivery, or any other write.
3. `CORTEX_MEETING_ADMIN_EMAILS` keeps its existing meaning and entries. Do not add Lew there as a shortcut.
4. Exact email normalization remains trim plus case-fold/lowercase; near-miss addresses do not match.
5. An outer OAuth grant is usable only when its embedded underlying bearer has exact `token_use == "mcp"`. The marker is an unverified shape precondition, never signature proof.
6. Bridge continues to validate the unchanged underlying bearer on new grant issuance and on actual Bridge requests.
7. Unsafe unmarked access and refresh rows are invalidated; they are not grandfathered. Affected connectors must re-consent. Marked compatible grants may continue.
8. Do not require the marker for the explicit stdio `CORTEX_USER_TOKEN` / `CORTEX_CHANNEL_KEY` fallback path in this remediation.
9. Never log, return, or include an embedded bearer in an error.

---

## Task 16A: Give configured super-admins full meeting reads without write authority

**Expected Cortex files:**

- Modify `funnel/meeting_intelligence/access.py`
- Modify `apps/bridge/routes/meetings_deps.py`
- Modify `apps/bridge/routes/meetings.py`
- Modify `tests/test_meeting_per_user_access.py`
- Create or modify a focused signed-route test such as `tests/test_superadmin_meeting_read_scope.py`

### Required contract

1. The authoritative meeting principal carries a distinct `full_tenant_read` boolean derived only from the server-verified email and the existing normalized `CORTEX_SUPER_ADMIN_EMAILS` set.
2. `is_admin` remains derived exactly as today from `CORTEX_MEETING_ADMIN_EMAILS` for per-user identities. A super-admin who is not a meeting admin has `full_tenant_read=True`, `is_admin=False`, and `per_user=True`.
3. A read-only artifact decision admits a full-tenant-read principal for valid meeting artifact types, including restricted classifications. Existing participant/business-context/admin behavior remains unchanged for everyone else.
4. Use the read-only decision for the meeting detail view and minutes pack. Do not use it from `/process`, `/classify`, `/legal-hold`, intake, live-action mutation, delivery, or other write paths.
5. The exact Lew address succeeds case-insensitively. An ordinary user and near-miss email remain narrowed/denied.

### Step 1: Write substantive RED tests

- Configure `CORTEX_SUPER_ADMIN_EMAILS` with multiple pre-existing entries plus exact Lew, and keep `CORTEX_MEETING_ADMIN_EMAILS` empty or unrelated.
- Use a real signed HS256 bearer with verified tenant/email claims and exact `token_use="mcp"` through the production Bridge authentication path.
- Read a nonparticipant business meeting and its pack as Lew; both must currently fail and then pass after the fix.
- Cover a restricted meeting to prove full tenant means full tenant read, not only business-context inheritance.
- Submit the same reads as an ordinary and near-miss address; both remain denied.
- Prove Lew still receives 403 on classify, legal-hold, process, and representative near-miss/write paths and that no registry/storage mutation occurred.
- Add pure-principal assertions showing all existing super-admin entries are honored and `is_admin` is still false unless separately meeting-admin.

The authorization claim must exercise real signature verification and production principal/access functions. Isolating registry or artifact persistence is acceptable, but do not present it as a live database proof.

### Step 2: Implement one read-only capability

- Reuse the existing normalized `CORTEX_SUPER_ADMIN_EMAILS` policy rather than introducing a new environment variable or copying only Lew.
- Extend the canonical `Principal` type and authoritative builder with `full_tenant_read`.
- Add a clearly named read-only artifact predicate or equivalent narrow branch.
- Keep `can_access` / `_require_admin` write-sensitive behavior unchanged. The implementation must make it difficult for a future process/write route to inherit read authority accidentally.

### Step 3: Verify and mutate

Run the focused principal, signed-route, meeting-route, marked-method-policy, and full-tenant-scope tests. Then remove each of these one at a time and require a failure:

- exact super-admin derivation;
- full-tenant meeting read branch;
- separation from `is_admin`;
- ordinary/near-miss denial;
- process/classify/legal-hold denial.

Restore GREEN, run changed-file Ruff and `git diff --check`, then commit:

```text
fix(meetings): separate full-tenant read from admin
```

Obtain an independent security review before Task 16B.

---

## Task 16B: Invalidate unsafe persisted outer OAuth grants

**Expected Cortex files:**

- Modify `apps/cortex_mcp/cortex_mcp_tokens.py` or create one small shared token-policy module
- Modify `apps/cortex_mcp/cortex_mcp_callback.py`
- Modify `apps/cortex_mcp/cortex_mcp_oauth.py`
- Modify `apps/cortex_mcp/server.py`
- Modify `tests/test_cortex_mcp_oauth.py`
- Modify `tests/test_cortex_mcp_oauth_grants.py`
- Modify focused callback/transport tests only where the shared-helper move requires it

### Required contract

1. One pure shared helper requires a three-part JWT payload object with exact `token_use == "mcp"`. Its name/docstring must state that decoding is unverified.
2. New callback/manual issuance still composes that precondition with unchanged-bearer, no-redirect Bridge validation.
3. `load_access_token` rejects an unsafe embedded bearer, invalidates the unsafe row/grant on disk atomically, and returns no credential.
4. `load_refresh_token` rejects and invalidates an unsafe row/grant. `exchange_refresh_token` repeats the precondition so a stale in-memory pre-deploy object cannot mint a new access token.
5. Invalidation removes unsafe siblings belonging to the same outer grant. For grant-less legacy rows, remove only rows proven to share the same unsafe embedded bearer; do not wipe unrelated grants.
6. Save failure restores in-memory state and fails closed. Never log or echo the bearer.
7. `_auth_token` applies defense in depth when a credential came from the outer OAuth request context. It rejects an unmarked embedded bearer before any Bridge request. With no outer OAuth context, existing stdio/environment fallback resolution remains unchanged.
8. A safe marked legacy access/refresh grant remains compatible, retains identity/resource/scopes, refreshes normally, and continues revocation cascade behavior.

### Step 1: Write substantive RED tests against the real JSON store

- Persist an unmarked opaque or valid signed-unmarked underlying bearer in access and refresh rows using a real temporary OAuth store.
- Prove current production provider code loads it, refreshes it, and `_auth_token` forwards it unchanged. These are the required RED failures.
- After the fix, access load returns `None`, refresh load returns `None`, stale-object exchange raises generic `invalid_grant`, no new access row appears, and the affected unsafe rows are absent after provider reload.
- Cover both legacy rows without `grant_id` and modern rows with a shared `grant_id`; unrelated marked grants remain byte-for-byte usable.
- Inject a real `CortexAccessToken` through the MCP auth ContextVar and prove unmarked outer credentials fail before `_headers` / Bridge transport while a marked credential is forwarded unchanged.
- Prove `CORTEX_USER_TOKEN` and `CORTEX_CHANNEL_KEY` fallback behavior is unchanged when there is no outer OAuth context.
- Prove errors and logs do not contain the embedded bearer.

### Step 2: Implement fail-closed loading, refresh, and use

- Move/reuse the marker precondition without creating an OAuth/callback import cycle.
- Keep invalidation logic small, grant-scoped, atomic, and explicit.
- Return protocol-appropriate generic invalid-token/invalid-grant behavior. Do not silently convert an unsafe outer grant to a stdio credential.
- Do not mutate the store at module import or startup merely because old rows exist; invalidate on presentation/load so the migration is fail-closed and observable without a blind bulk rewrite.

### Step 3: Verify and mutate

Run callback, OAuth, grant, expiry/limit, revocation, server credential-resolution, answer-read-only, and store durability suites. Mutate each of the following separately and require a failure:

- access-load marker gate;
- refresh-load gate;
- stale refresh-exchange gate;
- outer-context `_auth_token` defense;
- grant sibling invalidation;
- save-failure rollback;
- stdio fallback separation.

Restore GREEN, run changed-file Ruff and `git diff --check`, then commit:

```text
fix(oauth): invalidate unsafe legacy cortex grants
```

Obtain an independent security review before Task 16C.

---

## Task 16C: Correct compatibility and operator documentation

**Expected Cortex file:**

- Modify `docs/cortex-mcp-connect.md`

**Expected FibreFlow files:**

- Modify `docs/superpowers/specs/2026-07-30-cortex-mcp-fibreflow-consent-design.md`
- Modify `docs/superpowers/plans/2026-07-30-cortex-mcp-fibreflow-consent.md`

### Required contract

- Replace the unconditional “current access and refresh grants continue working” statement with the precise rule: marked compatible grants continue; unsafe unmarked grants fail closed and require re-consent.
- Update rollout and rollback instructions so they never require proving an unsafe legacy grant continues or preserving unsafe rows.
- State that adding Lew to `CORTEX_SUPER_ADMIN_EMAILS` grants full tenant reads, including meeting detail/pack, without meeting mutation/admin authority.
- Preserve the exact Cortex-first deployment and reverse-exposure rollback order.

Verify documentation against the focused runtime tests and `git diff --check`. Commit once per repository with scoped documentation subjects. Obtain an independent coordinated review.

---

## Task 16D: Re-run invalidated gates and final blind reviews

### Cortex verification

Run:

- all Task 16A signed-route/principal tests;
- all Task 16B callback/OAuth/grant/store/revocation tests;
- the previous 264-test focused security union;
- real PostgreSQL revocation integration and require `1 passed`, not skipped;
- `bun test apps/agent_executor/src` and executor TypeScript;
- `bash scripts/ci/run-ci.sh`;
- `git diff --check origin/main...HEAD` and tracked-clean status;
- read-only `deploy_bridge.sh --verify-only` to retain the known undeployed executor verdict.

### FibreFlow verification

Because Task 16C is documentation-only in FibreFlow, run `git diff --check origin/master...HEAD` and `bash scripts/secret-scan.sh`; carry forward substantive implementation gates with exact provenance. Keep the unchanged missing `antihall` validator and login-approval-blocked Playwright status explicit.

### Final review and publication gate

1. A fresh Cortex security reviewer inspects the full PR diff and explicitly retests both Task 16 findings plus all earlier Important fixes.
2. A fresh coordinated reviewer inspects both final heads, the compatibility correction, deployment order, and rollback.
3. Only after both approve: refresh target refs, resolve drift without force, push both branches, and open cross-linked draft PRs.
4. Stop before merge or deployment. Production configuration, allowlist mutation, login, isolated real connector proof, and promotion remain separate explicit approval gates.
