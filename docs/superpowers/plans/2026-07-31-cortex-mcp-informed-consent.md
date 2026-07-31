# Cortex MCP Informed Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the OAuth client-spoofing gap by showing the exact registered redirect destination before a FibreFlow user can authorize Cortex MCP.

**Architecture:** Add a FibreFlow-only, authenticated context proxy that calls Cortex Remote MCP over the existing secret-authenticated loopback boundary. Gate the existing consent card on that context and render every client-provided field as non-clickable React text; leave token minting and authorization completion unchanged.

**Tech Stack:** Next.js Pages Router, TypeScript, React, FibreFlow PostgreSQL RBAC middleware, Vitest, Testing Library, real loopback HTTP test servers, Playwright.

## Global Constraints

- Preserve existing FibreFlow MCP OAuth/RBAC behavior and Cortex read-only scope.
- Identity comes only from the verified FibreFlow session.
- The browser sends only `stateId`; it never supplies identity, token, secret or callback decisions.
- `CORTEX_MCP_CALLBACK_SECRET` is shared between FibreFlow's Cortex integration and Cortex Remote MCP but differs from `FF_MCP_CALLBACK_SECRET`.
- Client name, client ID, redirect URI and scopes are attacker-controlled text.
- Bind every resolved context to its exact `stateId`; a query change invalidates the
  old Allow action before the replacement context resolves.
- Cap the upstream response at 64 KiB and enforce bounded client and scope fields.
- The exact redirect URI is visible and non-clickable before Allow is enabled.
- Missing or invalid context fails closed with no Allow action.
- No mocks may stand in for the context integration; API contract tests use real loopback HTTP servers.
- Do not modify live environment files, restart services, deploy or merge in this plan.

---

### Task 1: Record the audit-driven design

**Files:**
- Create: `docs/superpowers/specs/2026-07-31-cortex-mcp-informed-consent-addendum-design.md`
- Create: `docs/superpowers/plans/2026-07-31-cortex-mcp-informed-consent.md`

**Interfaces:**
- Consumes: Cortex PR #145's `POST /authorize/context` response.
- Produces: the approved response contract and fail-closed UI behavior used by every later task.

- [ ] **Step 1: Verify the documents contain no placeholders or secret values**

Run:

```bash
rg -n 'T[B]D|TO[D]O|FF_MCP_CALLBACK_SECRET[=]' \
  docs/superpowers/specs/2026-07-31-cortex-mcp-informed-consent-addendum-design.md \
  docs/superpowers/plans/2026-07-31-cortex-mcp-informed-consent.md
```

Expected: no output and exit status 1 because no forbidden text is present.

- [ ] **Step 2: Commit the approved design and plan**

```bash
git add \
  docs/superpowers/specs/2026-07-31-cortex-mcp-informed-consent-addendum-design.md \
  docs/superpowers/plans/2026-07-31-cortex-mcp-informed-consent.md
git commit -m "docs(cortex): plan informed MCP consent fix"
```

### Task 2: Define and validate the context contract

**Files:**
- Create: `src/lib/cortex/mcpConsentContext.ts`
- Test: `src/lib/cortex/__tests__/mcpConsentContext.test.ts`

**Interfaces:**
- Consumes: the Cortex JSON fields `client_id`, `client_name`, `redirect_uri` and `scopes`.
- Produces: `parseCortexMcpConsentContext(value: unknown): CortexMcpConsentContext | null` and the exported `CortexMcpConsentContext` type.

- [ ] **Step 1: Write the failing parser tests**

```typescript
import { describe, expect, it } from 'vitest';
import { parseCortexMcpConsentContext } from '../mcpConsentContext';

describe('parseCortexMcpConsentContext', () => {
  it('maps only the informed-consent display fields', () => {
    expect(parseCortexMcpConsentContext({
      client_id: 'attacker-client',
      client_name: 'Claude',
      redirect_uri: 'https://evil.example/cb',
      scopes: ['cortex.read'],
      expires_at: 1_786_000_000,
      code_challenge: 'must-not-pass-through',
    })).toEqual({
      clientId: 'attacker-client',
      clientName: 'Claude',
      redirectUri: 'https://evil.example/cb',
      scopes: ['cortex.read'],
    });
  });

  it.each([
    null,
    {},
    { client_id: '', client_name: null, redirect_uri: 'https://evil.example/cb', scopes: [] },
    { client_id: 'client', client_name: 7, redirect_uri: 'https://evil.example/cb', scopes: [] },
    { client_id: 'client', client_name: null, redirect_uri: '', scopes: [] },
    { client_id: 'client', client_name: null, redirect_uri: 'https://evil.example/cb', scopes: 'cortex.read' },
  ])('rejects malformed context %#', (value) => {
    expect(parseCortexMcpConsentContext(value)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the parser test and confirm RED**

Run: `npx vitest run src/lib/cortex/__tests__/mcpConsentContext.test.ts`

Expected: FAIL because `mcpConsentContext.ts` does not exist.

- [ ] **Step 3: Implement the minimal parser**

```typescript
export interface CortexMcpConsentContext {
  clientId: string;
  clientName: string | null;
  redirectUri: string;
  scopes: string[];
}

export function parseCortexMcpConsentContext(
  value: unknown,
): CortexMcpConsentContext | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.client_id !== 'string' || !raw.client_id
    || (raw.client_name !== null && typeof raw.client_name !== 'string')
    || typeof raw.redirect_uri !== 'string' || !raw.redirect_uri
    || !Array.isArray(raw.scopes)
    || !raw.scopes.every((scope) => typeof scope === 'string')
  ) return null;
  return {
    clientId: raw.client_id,
    clientName: raw.client_name,
    redirectUri: raw.redirect_uri,
    scopes: raw.scopes,
  };
}
```

- [ ] **Step 4: Run the parser test and confirm GREEN**

Run: `npx vitest run src/lib/cortex/__tests__/mcpConsentContext.test.ts`

Expected: one file passing with no failures.

- [ ] **Step 5: Commit the context contract**

```bash
git add src/lib/cortex/mcpConsentContext.ts src/lib/cortex/__tests__/mcpConsentContext.test.ts
git commit -m "test(cortex): define MCP consent context contract"
```

### Task 3: Add the authenticated context proxy

**Files:**
- Create: `pages/api/cortex/mcp-consent-context.ts`
- Create: `pages/api/cortex/__tests__/mcpConsentContext.handler.test.ts`
- Create: `pages/api/cortex/__tests__/mcpConsentContext.testHarness.ts`

**Interfaces:**
- Consumes: browser JSON `{ stateId: string }`, `CORTEX_REMOTE_MCP_URL`, `CORTEX_MCP_CALLBACK_SECRET`, and Cortex `POST /authorize/context`.
- Produces: FibreFlow API success `{ data: CortexMcpConsentContext }` or a generic structured error.

- [ ] **Step 1: Add a focused real-HTTP harness for the context handler**

Add a `startConsentContextHandler()` helper in a separate file so the existing
233-line consent harness remains below the 300-line repository limit. Start the
actual handler on an ephemeral loopback port, use a real callback server, and record
the request path, method, secret header and JSON body. Do not replace `fetch`; the
handler must perform a real HTTP request to the callback server.

- [ ] **Step 2: Write failing real-HTTP contract tests**

Cover these literal behaviors:

```typescript
expect(callback.requests[0]).toMatchObject({
  path: '/authorize/context',
  method: 'POST',
  cortexSecret: CALLBACK_SECRET,
  json: { stateId: VALID_STATE_ID },
});
expect(response.json.data).toEqual({
  clientId: 'attacker-client',
  clientName: 'Claude',
  redirectUri: 'https://evil.example/cb',
  scopes: ['cortex.read'],
});
expect(JSON.stringify(response.json)).not.toContain(CALLBACK_SECRET);
expect(JSON.stringify(response.json)).not.toContain('code_challenge');
```

Also prove malformed state does not call upstream, missing secret fails before the
request, 3xx is not followed, non-2xx and invalid JSON return `BAD_GATEWAY`, malformed
context returns `BAD_GATEWAY`, and logs contain neither secret nor attacker metadata.

- [ ] **Step 3: Run the handler tests and confirm RED**

Run: `npx vitest run pages/api/cortex/__tests__/mcpConsentContext.handler.test.ts`

Expected: FAIL because the context API and harness entrypoint do not exist.

- [ ] **Step 4: Implement the minimal context handler**

The handler must:

```typescript
const upstream = await fetch(`${callbackBase}/authorize/context`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Cortex-MCP-Secret': secret,
  },
  body: JSON.stringify({ stateId }),
  signal: AbortSignal.timeout(5_000),
  redirect: 'manual',
});
```

Parse with `parseCortexMcpConsentContext`, return only the parsed camel-case fields,
and wrap the default route with the same feature flag, `withAuth`, POST-only check and
`withPermission('cortex.review', 'view')` order used by `mcp-consent.ts`.

- [ ] **Step 5: Run the context and existing consent API suites**

Run:

```bash
npx vitest run \
  pages/api/cortex/__tests__/mcpConsentContext.handler.test.ts \
  pages/api/cortex/__tests__/mcpConsent*.test.ts \
  src/lib/cortex/__tests__/mcpConsentContext.test.ts
```

Expected: all selected files pass; the existing mint/complete behavior remains green.

- [ ] **Step 6: Commit the API boundary**

```bash
git add \
  pages/api/cortex/mcp-consent-context.ts \
  pages/api/cortex/__tests__/mcpConsentContext.handler.test.ts \
  pages/api/cortex/__tests__/mcpConsentContext.testHarness.ts
git commit -m "fix(cortex): proxy informed MCP consent context"
```

### Task 4: Gate the consent UI on verified context

**Files:**
- Modify: `pages/cortex/mcp/authorize.tsx`
- Modify: `src/components/cortex/CortexMcpConsentCard.tsx`
- Modify: `tests/pages/cortex-mcp-consent-browser.tsx`
- Modify: `tests/pages/cortex-mcp-authorize.test.tsx`

**Interfaces:**
- Consumes: `POST /api/cortex/mcp-consent-context` returning `CortexMcpConsentContext`.
- Produces: an Allow action only after displaying the untrusted client name and exact redirect URI.

- [ ] **Step 1: Extend the browser harness with a valid context response**

Use this hand-written response fixture:

```typescript
export const ATTACKER_CONTEXT = {
  clientId: 'attacker-client',
  clientName: 'Claude',
  redirectUri: 'https://evil.example/cb',
  scopes: ['cortex.read'],
};
```

Record `/api/cortex/mcp-consent-context` separately from the existing consent request.

- [ ] **Step 2: Write failing browser behavior tests**

Prove that the page:

```typescript
expect(await screen.findByText('https://evil.example/cb')).toBeInTheDocument();
expect(screen.getByText('Claude')).toBeInTheDocument();
expect(screen.getByText(/provided by the connector/i)).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
```

Add an XSS fixture whose `clientName` is
`<img data-attacker="true" src=x onerror=alert(1)>`; assert the literal text renders
and `document.querySelector('[data-attacker="true"]')` is null. Add context rejection,
missing-data and network-failure cases and assert no Allow button is rendered. Assert
the context request contains only `{ stateId: STATE_ID }`.

Add adversarial redirect and scope fixtures, assert the redirect has no anchor ancestor
or link role, and mutate from state A to state B while B's context request is pending.
The old context and Allow action must disappear immediately, and the eventual consent
request must contain state B only.

- [ ] **Step 3: Run the page test and confirm RED**

Run: `npx vitest run tests/pages/cortex-mcp-authorize.test.tsx`

Expected: FAIL because the page never requests or renders context.

- [ ] **Step 4: Implement the context loading gate**

After router and authentication hydration, post only `{ stateId }` to the new endpoint.
Keep phase `checking` until a valid response is stored. On any failure set the generic
error phase. Pass the typed context into `CortexMcpConsentCard`; if context is null,
the card must never render Allow.

Render the redirect URI in a wrapping `<code>` element without `href` or
`dangerouslySetInnerHTML`. Label the name as connector-provided and the URI as the
destination that receives the authorization result.

- [ ] **Step 5: Run the page and API suites and confirm GREEN**

Run:

```bash
npx vitest run \
  tests/pages/cortex-mcp-authorize.test.tsx \
  pages/api/cortex/__tests__/mcpConsentContext.handler.test.ts \
  pages/api/cortex/__tests__/mcpConsent*.test.ts \
  src/lib/cortex/__tests__/mcpConsentContext.test.ts
```

Expected: every selected test passes with no failures.

- [ ] **Step 6: Commit the informed consent UI**

```bash
git add \
  pages/cortex/mcp/authorize.tsx \
  src/components/cortex/CortexMcpConsentCard.tsx \
  tests/pages/cortex-mcp-consent-browser.tsx \
  tests/pages/cortex-mcp-authorize.test.tsx
git commit -m "fix(cortex): show MCP authorization destination"
```

### Task 5: Verify the security fix and prepare the PR

**Files:**
- Modify only if verification exposes a defect in the files listed above.

**Interfaces:**
- Consumes: the complete branch.
- Produces: reviewable evidence without deployment, live configuration changes or merge.

- [ ] **Step 1: Run the focused regression set**

```bash
npx vitest run \
  tests/pages/cortex-mcp-authorize.test.tsx \
  pages/api/cortex/__tests__/mcpConsentContext.handler.test.ts \
  pages/api/cortex/__tests__/mcpConsent*.test.ts \
  src/lib/cortex/__tests__/mcpConsentContext.test.ts
```

- [ ] **Step 2: Run the mandatory repository gate**

Run: `npm run ci:quick`

Expected: exit status 0. Existing non-blocking TypeScript diagnostics must be reported
with their exact count rather than described as newly clean.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: exit status 0.

- [ ] **Step 4: Run Playwright against an isolated local server**

Start FibreFlow on an unused local port with test-only environment values and a real
ephemeral loopback context service. Exercise the authenticated consent page at desktop
and mobile widths. Verify the exact attacker redirect is visible, no injected element
exists, and context failure removes Allow. Do not repoint production OAuth or use the
live OAuth store.

- [ ] **Step 5: Inspect the final diff and secret scan**

```bash
git status --short
git diff origin/master...HEAD --check
git diff origin/master...HEAD --stat
rg -n 'CORTEX_MCP_CALLBACK_SECRET[=]|FF_MCP_CALLBACK_SECRET[=]' \
  pages src tests docs/superpowers
```

Expected: only scoped files are changed, diff check is clean, and no secret assignment
appears.

- [ ] **Step 6: Push and open the pull request**

```bash
gh pr create \
  --repo VelocityFibre/FF_Next.js \
  --base master \
  --head fix/cortex-consent-context \
  --title "fix(cortex): show OAuth redirect before consent" \
  --body-file /tmp/cortex-consent-context-pr.md
```

The PR body must include the attacker flow, red/green test evidence, focused test
counts, `ci:quick`, build and Playwright results, and state explicitly that nothing was
deployed or changed in live configuration.
