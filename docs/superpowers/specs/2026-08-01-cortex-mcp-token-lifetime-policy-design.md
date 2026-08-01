# Cortex MCP Token Lifetime Policy Design

**Date:** 2026-08-01
**Status:** Approved by Hein
**Repositories:** FibreFlow Next.js and Cortex

## Context

The normal Cortex connector flow now uses FibreFlow login and consent. It mints a
90-day, read-only Cortex bearer server-side and never asks the user to paste a token.
That remains the primary workflow. This is the underlying bearer lifetime, not the
outer OAuth grant lifetime: the Cortex refresh grant expires after 30 days, at which
point the user must complete browser reauthorization even though the bearer claim is
90 days.

FibreFlow also retains an authenticated `POST /api/cortex/mcp-token` operator path
for clients that cannot complete browser OAuth. At approval time, the library already
modeled four lifetimes (`30d`, `90d`, `1y`, and `never`), but the route blocked
`never` and the signer rejected `1y` and `never` when the verified email was in
`CORTEX_SUPER_ADMIN_EMAILS`.

Hein corrected that policy: a super admin may choose the same lifetime as any other
authorized user, including one year or no expiry.

## Decision

1. Keep the underlying bearer for normal Cortex browser OAuth fixed at 90 days and
   the outer refresh grant fixed at 30 days with browser reauthorization on expiry.
2. Add collapsed Advanced manual-token controls to `/connections/cortex`.
3. Offer `30 days`, `90 days`, `1 year`, and `Never expires` to every user who
   already passes FibreFlow authentication and `cortex.review:view`.
4. Remove the special super-admin lifetime ceiling. `CORTEX_SUPER_ADMIN_EMAILS`
   continues to decide Cortex retrieval breadth in Cortex Bridge; FibreFlow does not
   need that allowlist for token-lifetime policy.
5. Keep Cortex MCP read-only and preserve all existing identity, RBAC, tenant,
   revocation, signing, OAuth, and callback-secret boundaries.
6. Treat Cortex as the authoritative read-only enforcement point. FibreFlow's proxy
   mirrors the allowlist as defense in depth, but a marked Cortex MCP bearer must be
   unable to reach a write-capable Cortex execution path even through direct Bridge
   access or a framework routing near miss.

## Considered approaches

### A. Advanced UI plus backend policy correction — selected

Expose the existing manual mint path only inside the collapsed Advanced section,
allow all four lifetimes, and remove the obsolete super-admin exception. This makes
the approved fallback usable without adding friction to normal OAuth.

### B. Backend correction only

The endpoint would accept the policy, but users would have no supported UI to use it.
That leaves the capability effectively hidden and encourages ad-hoc API calls.

### C. Add lifetime selection to normal OAuth

This makes every connector setup more complex and weakens the approved no-token-paste,
single-consent journey. It is unnecessary because Advanced already provides the right
boundary for exceptional clients.

## User experience

The existing Cortex connector card and browser-consent instructions remain first.
The Advanced disclosure contains:

- a lifetime selector with `30 days` as the default;
- `90 days`, `1 year`, and `Never expires` alternatives;
- a `Generate token` action;
- a one-time token reveal and copy action;
- an explicit password-equivalent warning;
- an additional warning when `Never expires` is selected; and
- the existing `Revoke all Cortex tokens` action.

An indefinite token displays `Does not expire — revoke it manually` rather than an
empty or fabricated expiry date. The token exists only in React state, is never
logged, and disappears on reload.

## API and token semantics

`POST /api/cortex/mcp-token` accepts exactly:

```text
30d | 90d | 1y | never
```

Identity remains `req.user.email` from the verified FibreFlow session; the request
body cannot supply an email, role, tenant, scope, or signing input. The existing
outer feature flag and `cortex.review:view` gate remain unchanged.

`never` produces a signed JWT with no `exp` claim and returns `expiresAt: null`.
Every manually minted token still carries `token_use: "mcp"` and a unique `jti`, so
the existing per-user revocation epoch invalidates it. `DELETE /api/cortex/mcp-token`
continues to revoke all of the verified caller's Cortex MCP tokens.

The normal consent handler continues to call `mintMcpToken(req.user.email, '90d')`.
No lifetime selector or bearer reveal is added to the normal OAuth path.

## Component boundaries

- `CortexConnectionPanel` owns Advanced open/close state, manual mint network state,
  copy state, and revoke state.
- A small Cortex manual-token control component owns the selector, warnings, generate
  action, and one-time reveal presentation so `CortexConnectionPanel` stays below the
  repository's component-size limit.
- Shared reveal presentation may be extracted only if its copy and accessible labels
  remain resource-specific for FibreFlow Operations versus Cortex Knowledge.
- `bridgeAuth.ts` retains the lifetime-to-JWT conversion but removes the super-admin
  lookup and typed cap error.
- `mcp-token.ts` admits all four `Lifetime` values and removes cap-specific error
  handling.

## Failure handling

- Invalid lifetime values return `400` and mint nothing.
- Missing authentication, permission, feature flag, or signing secret continues to
  fail closed exactly as today.
- Failed minting clears any prior one-time reveal and displays the server-safe error.
- Clipboard failure leaves the token visible for manual selection.
- Revocation failure does not claim success or discard the currently revealed token.

## Testing and evidence

Use TDD. New policy tests exercise real production functions and real signing rather
than mocks:

- a configured super-admin can mint a real, verifiable one-year JWT;
- a configured super-admin can mint a real, verifiable JWT without `exp`;
- the route lifetime validator accepts all four exact values and rejects malformed or
  client-invented values;
- normal consent still requests exactly `90d`;
- the rendered Advanced Cortex UI exposes all four choices, sends the selected value,
  reveals the returned token once, describes indefinite expiry accurately, and keeps
  revoke available;
- the normal connector card remains the primary UI and contains no token-paste step;
- real signed-bearer Cortex tests prove the authoritative route matrix, safe answer
  execution, full-scope-only derived stores, and immediate revocation; and
- focused Vitest/Pytest, repository CI, build, and Playwright cover the coordinated
  change.

No live token values, cookies, retrieved Cortex content, or secrets may appear in test
output, screenshots, commits, or PR text.

## Rollout and rollback

All code changes go through coordinated FibreFlow and Cortex PRs. No merge,
configuration change, restart, or deployment is authorized until review is complete
and Hein explicitly approves the relevant rollout step.

When rollout is approved, an isolated Agent Executor on `17406` deploys to dev proof
first. The isolated Bridge must use `EXECUTOR_URL=http://127.0.0.1:17406`, never
production `7406`; isolated Remote MCP uses its own process, unique OAuth store, and
dev public base. Then Cortex's authoritative Bridge/Remote enforcement must pass real
negative mutation, routing-near-miss, safe-answer, full-scope-derived-store, and
immediate-revocation tests. Only then may the FibreFlow UI/proxy deploy to dev through
`scripts/deploy-local.sh` for the visibility-only browser flow. Production remains a
separate explicit approval gate in the same Executor → Bridge/Remote MCP → FibreFlow
order.

Before either rollout, compare callback secrets by non-reversible hash: FibreFlow and
Remote MCP must match, while `CORTEX_MCP_CALLBACK_SECRET` and
`FF_MCP_CALLBACK_SECRET` must differ. Require hash agreement for FibreFlow/Bridge
`BRIDGE_JWT_SECRET` and exact `BRIDGE_JWT_KID` agreement when configured. Read back
the complete effective `CORTEX_SUPER_ADMIN_EMAILS` set, prove it includes
`lew@velocityfibre.co.za`, and abort if any previous entry was dropped. Record only
verdicts, never secret or key values.

Rollback reverses exposure first: remove the FibreFlow UI/proxy, then unwind
Bridge/Remote MCP, and roll back Agent Executor last if needed. Each repository uses
its supported deployment path. Existing OAuth grants and already-issued manual tokens
remain governed by their JWT claims and the existing revocation epoch; rollback does
not silently revoke users.

## Non-goals

- Changing Lew's full-tenant Cortex scope.
- Changing the normal underlying bearer from 90 days or the outer refresh grant from
  its 30-day browser-reauthorization boundary.
- Adding write-capable MCP tools.
- Persisting or listing Cortex JWT values in FibreFlow.
- Changing FibreFlow Operations MCP token lifetimes.
- Changing Cortex OAuth store formats, callback secrets, or the unlinked rollback
  authorization path.
