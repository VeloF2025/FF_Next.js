# Cortex MCP Token Lifetimes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authorized users manually mint read-only Cortex MCP tokens for 30 days, 90 days, one year, or indefinitely from `/connections/cortex`, without changing the normal 90-day OAuth consent flow.

**Architecture:** A server-safe policy module becomes the single source of truth for accepted lifetime values and JWT durations. The existing signer consumes it without consulting the super-admin allowlist, the authenticated API admits all four values, and a dedicated Advanced UI component performs one-time reveal while the normal connector card remains primary.

**Tech Stack:** Next.js Pages Router, React, TypeScript, `jose`, Vitest, Testing Library, Playwright, npm.

## Global Constraints

- Normal Cortex OAuth stays fixed at `90d`; do not add lifetime selection or token reveal to `/cortex/mcp/authorize`.
- Advanced manual Cortex minting offers exactly `30d`, `90d`, `1y`, and `never` to every authenticated user with `cortex.review:view`.
- There is no special super-admin lifetime ceiling. `CORTEX_SUPER_ADMIN_EMAILS` remains a Cortex Bridge retrieval-scope setting only.
- `never` means no JWT `exp` and `expiresAt: null`; the token remains revocable through `token_use: "mcp"`, `jti`, and the per-user revocation epoch.
- Identity comes only from `req.user.email`. Never accept email, role, tenant, scope, signing input, or redirect data from the body.
- Preserve read-only enforcement, OAuth, RBAC, tenant isolation, signing, revocation, callback secrets, and the rollback authorization route.
- Never log or persist token values. Never put tokens, secrets, cookies, or private Cortex content in screenshots, commits, PR text, or test output.
- New policy tests use real production functions and real JWT signing. Add no module mocks or fake implementations.
- Use npm only; do not regenerate `bun.lock`.
- All code goes through coordinated FibreFlow and Cortex PRs. No merge or deployment
  is authorized by this plan; dev and production each need the applicable explicit
  approval, with Cortex enforcement always rolling out first.

## File Map

- Create `src/lib/cortex/mcpLifetimePolicy.ts`: exact accepted values, day map, and type guard.
- Modify `src/lib/cortex/bridgeAuth.ts`: consume the policy and remove the cap/error.
- Modify `src/lib/cortex/__tests__/mcpToken.test.ts`: real-crypto one-year and no-expiry proofs.
- Create `src/lib/cortex/__tests__/mcpLifetimePolicy.test.ts`: exact policy validation.
- Modify `pages/api/cortex/mcp-token.ts`: admit all four values and remove cap handling.
- Modify `pages/api/cortex/__tests__/mcpToken.handler.test.ts`: update the existing route-boundary contract.
- Create `src/components/connections/CortexManualTokenControls.tsx`: selector, warnings, generation, copy, and one-time reveal.
- Modify `src/components/connections/CortexConnectionPanel.tsx`: own mint/copy/revoke state.
- Modify `src/components/connections/__tests__/CortexConnectionPanel.test.tsx`: Cortex DOM and HTTP-boundary contract.
- Verify `src/components/connections/__tests__/FibreFlowConnectionPanel.test.tsx`: split FibreFlow panel regression contract.
- Modify `tests/e2e/ai-connections.spec.ts`: real-browser UI proof without minting a live indefinite credential.
- Verify unchanged `pages/api/cortex/mcp-consent.ts`: normal consent still mints exactly `90d`.

---

### Task 1: Establish the lifetime policy and remove the signer cap

**Files:**
- Create: `src/lib/cortex/mcpLifetimePolicy.ts`
- Create: `src/lib/cortex/__tests__/mcpLifetimePolicy.test.ts`
- Modify: `src/lib/cortex/bridgeAuth.ts:31-58,147-196`
- Modify: `src/lib/cortex/__tests__/mcpToken.test.ts:149-187`

**Interfaces:**
- Produces `CORTEX_MCP_LIFETIMES`, `CORTEX_MCP_LIFETIME_DAYS`, `CortexMcpLifetime`, and `isCortexMcpLifetime(value)`.
- `bridgeAuth.ts` preserves its exported `Lifetime` and `LIFETIME_DAYS` names as aliases for existing callers.
- Existing `signBridgeJwt()` and revocable MCP claims remain unchanged.

- [ ] **Step 1: Write failing real-crypto super-admin tests**

Replace the cap suite in `mcpToken.test.ts` with tests that configure `CORTEX_SUPER_ADMIN_EMAILS`, call the real `mintMcpToken`, and verify with `jwtVerify`:

```typescript
it('signs a one-year token for a configured super-admin', async () => {
  const { token, expiresAt } = await mintMcpToken(ADMIN, '1y');
  const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));
  expect(payload.exp! - payload.iat!).toBe(365 * 24 * 60 * 60);
  expect(expiresAt).not.toBeNull();
});

it('signs a revocable no-expiry token for a configured super-admin', async () => {
  const { token, expiresAt } = await mintMcpToken(ADMIN, 'never');
  const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));
  expect(payload.exp).toBeUndefined();
  expect(payload.token_use).toBe('mcp');
  expect(typeof payload.jti).toBe('string');
  expect(expiresAt).toBeNull();
});
```

- [ ] **Step 2: Verify signer RED**

Run `npx vitest run src/lib/cortex/__tests__/mcpToken.test.ts`.

Expected: both tests fail with the current 90-day cap error.

- [ ] **Step 3: Write the failing shared-policy test**

Create `mcpLifetimePolicy.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  CORTEX_MCP_LIFETIMES,
  CORTEX_MCP_LIFETIME_DAYS,
  isCortexMcpLifetime,
} from '../mcpLifetimePolicy';

describe('Cortex MCP manual lifetime policy', () => {
  it('admits exactly the four approved values', () => {
    expect(CORTEX_MCP_LIFETIMES).toEqual(['30d', '90d', '1y', 'never']);
    for (const value of CORTEX_MCP_LIFETIMES) {
      expect(isCortexMcpLifetime(value)).toBe(true);
    }
  });

  it.each([undefined, null, 365, '', 'forever', 'Never', '1 year'])(
    'rejects an unrecognized lifetime: %s',
    (value) => expect(isCortexMcpLifetime(value)).toBe(false),
  );

  it('maps never to no expiry duration', () => {
    expect(CORTEX_MCP_LIFETIME_DAYS).toEqual({
      '30d': 30,
      '90d': 90,
      '1y': 365,
      never: null,
    });
  });
});
```

- [ ] **Step 4: Verify policy RED**

Run `npx vitest run src/lib/cortex/__tests__/mcpLifetimePolicy.test.ts`.

Expected: FAIL because the policy module does not exist.

- [ ] **Step 5: Implement the shared policy**

Create `mcpLifetimePolicy.ts`:

```typescript
export const CORTEX_MCP_LIFETIMES = ['30d', '90d', '1y', 'never'] as const;
export type CortexMcpLifetime = (typeof CORTEX_MCP_LIFETIMES)[number];

export const CORTEX_MCP_LIFETIME_DAYS: Record<CortexMcpLifetime, number | null> = {
  '30d': 30,
  '90d': 90,
  '1y': 365,
  never: null,
};

export function isCortexMcpLifetime(value: unknown): value is CortexMcpLifetime {
  return typeof value === 'string'
    && (CORTEX_MCP_LIFETIMES as readonly string[]).includes(value);
}
```

- [ ] **Step 6: Remove the cap from `bridgeAuth.ts`**

Import the policy, alias existing exports, delete `isSuperAdmin`, delete `McpLifetimeCapError`, remove the cap guard, and update comments. Preserve the rest of `mintMcpToken` exactly:

```typescript
export type Lifetime = CortexMcpLifetime;
export const LIFETIME_DAYS = CORTEX_MCP_LIFETIME_DAYS;
```

- [ ] **Step 7: Verify GREEN**

Run `npx vitest run src/lib/cortex/__tests__/mcpLifetimePolicy.test.ts src/lib/cortex/__tests__/mcpToken.test.ts`.

Expected: both files pass with real signatures and claims.

- [ ] **Step 8: Commit Task 1**

Stage only the four Task 1 files and commit `fix(cortex): allow flexible MCP token lifetimes`.

---

### Task 2: Admit every approved lifetime at the API boundary

**Files:**
- Modify: `pages/api/cortex/mcp-token.ts:1-78`
- Modify: `pages/api/cortex/__tests__/mcpToken.handler.test.ts:1-205`
- Verify unchanged: `pages/api/cortex/mcp-consent.ts:43-72`

**Interfaces:**
- Consumes `CORTEX_MCP_LIFETIMES` and `isCortexMcpLifetime` from Task 1.
- Produces an authenticated POST boundary accepting exactly the four values and signing only for `req.user.email`.
- Preserves the feature flag, auth/RBAC gates, generic 500 handling, and DELETE revocation.

- [ ] **Step 1: Change the existing route expectation first**

Remove the cap-error test/import, delete the old `never` rejection test, and extend the accepted table:

```typescript
it.each(['30d', '90d', '1y', 'never'] as const)(
  '200s and passes lifetime %s through to mintMcpToken',
  async (lifetime) => {
    principal.email = 'alice@velocityfibre.co.za';
    const { res, done } = run('POST', { lifetime });
    await done;
    expect(res._getStatusCode()).toBe(200);
    expect(mintMcpToken).toHaveBeenCalledWith(
      'alice@velocityfibre.co.za',
      lifetime,
    );
  },
);
```

Retain invalid-string and non-string rejection. Add no new mocks; this file keeps only its existing route-boundary seams, while Task 1 proves the real policy and crypto.

- [ ] **Step 2: Verify route RED**

Run `npx vitest run pages/api/cortex/__tests__/mcpToken.handler.test.ts`.

Expected: the `never` case gets `400` and never calls the signer.

- [ ] **Step 3: Use the shared policy in the route**

Remove the route-local phase gate and cap-specific catch. Validate and mint:

```typescript
const raw: unknown = req.body?.lifetime ?? '30d';
if (!isCortexMcpLifetime(raw)) {
  return apiResponse.badRequest(
    res,
    `lifetime must be one of ${CORTEX_MCP_LIFETIMES.join(', ')}`,
  );
}
const { token, expiresAt } = await mintMcpToken(req.user.email, raw);
return apiResponse.success(res, { token, expiresAt });
```

Document all four route values and remove every cap/phase-gate comment.

- [ ] **Step 4: Verify route GREEN and normal consent regression**

Run `npx vitest run pages/api/cortex/__tests__/mcpToken.handler.test.ts pages/api/cortex/__tests__/mcpConsent.handler.test.ts src/lib/cortex/__tests__/mcpLifetimePolicy.test.ts src/lib/cortex/__tests__/mcpToken.test.ts`.

Expected: all pass, including normal consent's exact `90d` call.

- [ ] **Step 5: Commit Task 2**

Stage the route and route test only. Commit `feat(cortex): accept indefinite manual MCP tokens`.

---

### Task 3: Add Cortex Advanced manual-token controls

**Files:**
- Create: `src/components/connections/CortexManualTokenControls.tsx`
- Modify: `src/components/connections/CortexConnectionPanel.tsx`
- Modify: `src/components/connections/__tests__/CortexConnectionPanel.test.tsx`
- Verify: `src/components/connections/__tests__/FibreFlowConnectionPanel.test.tsx`
- Modify: `tests/e2e/ai-connections.spec.ts`

**Interfaces:**
- Consumes `CortexMcpLifetime`, POST/DELETE `/api/cortex/mcp-token`, and the existing feature flag.
- Produces controlled Cortex-specific selector, warnings, one-time reveal, and copy action.
- Preserves the collapsed Advanced boundary, normal connector card order, and revoke-all behavior.

- [ ] **Step 1: Write failing component tests**

Add one test proving the selector is absent until Advanced opens and then contains all four labels. Add a second controlled-network test:

```typescript
it('mints and reveals an indefinite Cortex token through the POST boundary', async () => {
  const network = renderWithNetwork(<CortexConnectionPanel revokeEnabled />, {
    'POST /api/cortex/mcp-token': {
      status: 200,
      body: { data: { token: 'ctx_test_one_time', expiresAt: null } },
    },
  });
  fireEvent.click(screen.getByText('Advanced'));
  fireEvent.change(screen.getByLabelText('Cortex token lifetime'), {
    target: { value: 'never' },
  });
  expect(screen.getByText(/does not expire until you revoke it/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Generate Cortex token' }));
  expect(await screen.findByDisplayValue('ctx_test_one_time')).toBeInTheDocument();
  expect(screen.getByText(/Does not expire — revoke it manually/i)).toBeInTheDocument();
  expect(network.recordedRequests()).toContainEqual({
    method: 'POST',
    path: '/api/cortex/mcp-token',
    json: { lifetime: 'never' },
  });
});
```

Do not mock the component, hooks, lifetime policy, or crypto. The existing `NetworkBoundary` is an explicit HTTP contract responder, not an asserted production integration.

- [ ] **Step 2: Add the failing Playwright visibility test**

Add a Cortex-only test that opens Advanced and asserts the exact four option labels plus Generate/Revoke buttons. Do not click Generate against shared dev because revoke-all cannot invalidate only the test token without affecting the user's other tokens.

- [ ] **Step 3: Verify component RED**

Run `npx vitest run src/components/connections/__tests__/CortexConnectionPanel.test.tsx src/components/connections/__tests__/FibreFlowConnectionPanel.test.tsx`.

Expected: selector and Generate-button assertions fail because the UI does not exist.

- [ ] **Step 4: Create `CortexManualTokenControls`**

Use controlled props typed with `CortexMcpLifetime`. Render the exact options `30 days`, `90 days`, `1 year`, `Never expires`; default is supplied by the parent as `30d`. Render:

- `Generate Cortex token`;
- password-equivalent warning;
- conditional `This token does not expire until you revoke it` warning;
- one-time input with `aria-label="Cortex MCP token"`;
- dated expiry or `Does not expire — revoke it manually`;
- copy/copy-failed state.

Keep the component below 200 lines and never persist or log the token.

- [ ] **Step 5: Wire mint state into `CortexConnectionPanel`**

Add `lifetime`, `minting`, `token`, `expiresAt`, `copied`, and `manualError` state. POST only `{ lifetime }`. Validate a non-empty token and an `expiresAt` value that is string or null. Clear a prior reveal before minting; clear it after successful revoke; keep it visible when revoke fails. Preserve connector card first and Advanced collapsed.

- [ ] **Step 6: Verify component GREEN**

Run `npx vitest run src/components/connections/__tests__/CortexConnectionPanel.test.tsx src/components/connections/__tests__/FibreFlowConnectionPanel.test.tsx`.

Expected: all Cortex and FibreFlow panel tests pass.

- [ ] **Step 7: Prove `/cortex` remains knowledge-only**

Run `npx vitest run tests/pages/connections.test.tsx tests/pages/cortex-page.test.tsx`.

Expected: manual controls exist only at `/connections/cortex`, never `/cortex`.

- [ ] **Step 8: Commit Task 3**

Stage the new component, panel, component tests, and Playwright spec. Commit `feat(cortex): add advanced manual token controls`.

---

### Task 4: Verify, review, and publish the coordinated PRs

**Files:**
- Verify all files from Tasks 1-3.
- Preserve the committed design and this implementation plan.

**Interfaces:**
- Consumes the complete implementation.
- Produces reviewable FibreFlow and Cortex PRs with reproducible evidence, reciprocal links, and no deployment side effects.

- [ ] **Step 1: Run the complete focused suite**

Run `npx vitest run src/lib/cortex/__tests__/mcpLifetimePolicy.test.ts src/lib/cortex/__tests__/mcpToken.test.ts pages/api/cortex/__tests__/mcpToken.handler.test.ts pages/api/cortex/__tests__/mcpConsent.handler.test.ts src/components/connections/__tests__/CortexConnectionPanel.test.tsx src/components/connections/__tests__/FibreFlowConnectionPanel.test.tsx tests/pages/connections.test.tsx tests/pages/cortex-page.test.tsx`.

Expected: zero failed tests.

- [ ] **Step 2: Run repository gates**

In FibreFlow, run separately `npm run ci:quick`, `npm run antihall`, and the
environment-complete `npm run build`. In Cortex, run the focused Pytest/Bun suites
and `bash scripts/ci/run-ci.sh`. Read every exit code. Report an existing baseline
failure separately; never call a failing gate clean.

- [ ] **Step 3: Inspect scope and cleanliness**

Run the FibreFlow `git diff origin/master...HEAD --check`, stat, and clean-status
checks, plus the corresponding Cortex checks against `origin/main`.

Expected: only approved coordinated policy, enforcement, API, UI, documentation,
and tests changed; both worktrees are clean after their final commits.

- [ ] **Step 4: Request independent review**

Request independent FibreFlow and Cortex reviews plus a final cross-repository review.
Review line by line for verified-session identity, no-expiry revocation, no
super-admin cap, normal OAuth fixed at `90d`, authoritative server-side read-only
enforcement, no token logging/persistence, and `/cortex` knowledge-only. Address
findings through receiving-code-review and rerun affected gates.

- [ ] **Step 5: Push and open coordinated draft PRs with `gh`**

After both final reviews approve, publish the reviewed FibreFlow and Cortex branches
and use `gh pr create` to open a FibreFlow draft against `master` and a Cortex draft
against `main`. Cross-link the two PRs and state the mandatory Cortex-first rollout
order.

Both PR bodies state that nothing was deployed or changed in live configuration,
list exact verification results, and contain no credentials or private content.

- [ ] **Step 6: Hold deployment gates**

Do not merge or deploy without the next scoped approval. After an approved merge,
deploy Cortex enforcement to dev first and prove negative mutation attempts,
framework near misses, safe answer execution, full-scope derived-store restrictions,
and immediate revoke with a dedicated test identity. Only then deploy FibreFlow to
dev with `bash scripts/deploy-local.sh dev`, run authenticated Playwright and the
isolated real connector test, and visually inspect desktop/mobile. Production is a
separate explicit approval gate and uses the same Cortex-first order; FibreFlow
production deploys only via `bash scripts/deploy-local.sh production`.

Never mint an indefinite live token for Hein or Lew only for testing: the current revoke-all design cannot invalidate just that test token without also revoking their existing Cortex MCP tokens.
