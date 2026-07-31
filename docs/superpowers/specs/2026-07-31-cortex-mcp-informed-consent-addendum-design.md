# Cortex MCP Informed Consent Security Addendum

**Date:** 2026-07-31
**Status:** Approved by Hein following the independent OAuth audit
**Parent design:** `docs/superpowers/specs/2026-07-30-cortex-mcp-fibreflow-consent-design.md`
**Companion Cortex remediation:** `Heinvv10/Cortex#145`

## Problem

Cortex now records and exposes the OAuth client's registered name, redirect URI and
requested scopes through its secret-authenticated loopback `POST /authorize/context`
endpoint. FibreFlow's consent page still receives only an opaque `state_id`.

Because Cortex supports dynamic client registration, an attacker can register a
client named `Claude` with an attacker-controlled redirect URI and send its consent
URL to a signed-in FibreFlow user. A consent screen that says only "Allow Claude"
cannot distinguish that client from the real application. The authorization code
would be bound to the victim's verified FibreFlow identity and delivered to the
attacker's registered URI.

## Approved change

Add a dedicated FibreFlow `POST /api/cortex/mcp-consent-context` endpoint. It uses the
same outer feature flag, FibreFlow session authentication and
`cortex.review:view` permission gate as the existing consent endpoint. The browser
sends only `{ stateId }`; FibreFlow validates the state shape and calls Cortex's
loopback `/authorize/context` endpoint with `X-Cortex-MCP-Secret`.

The FibreFlow endpoint returns only the display fields needed for informed consent:

```typescript
interface CortexMcpConsentContext {
  clientId: string;
  clientName: string | null;
  redirectUri: string;
  scopes: string[];
}
```

The consent page remains in its loading phase until this context succeeds. It shows:

- a generic Cortex authorization heading that does not endorse the client name;
- the client name under an explicit "provided by the connector" label;
- the exact, non-clickable redirect URI where the authorization result will go;
- the requested scopes and the verified FibreFlow email.

The client name, client ID, redirect URI and scopes are attacker-controlled display
data. React renders them only as text. They are never inserted as HTML and the
redirect URI is not turned into a link.

## Failure behavior

The page must not render an Allow action until valid context has been received.
Malformed state, missing configuration, upstream redirects, timeout, non-2xx status,
invalid JSON and invalid context all return a generic failure. Logs may include the
verified FibreFlow user ID and upstream status, but never the callback secret,
attacker-controlled metadata, authorization state, bearer or token.

The existing `POST /api/cortex/mcp-consent` authorization path remains unchanged. It
still derives identity only from the verified FibreFlow session and sends the minted
bearer only across the authenticated loopback callback.

## Security boundaries

- `CORTEX_MCP_CALLBACK_SECRET` is identical only between FibreFlow's Cortex callback
  integration and Cortex Remote MCP. It remains distinct from
  `FF_MCP_CALLBACK_SECRET`.
- The context endpoint is loopback-only from FibreFlow and refuses redirects.
- No redirect allowlist is added; informed consent remains compatible with legitimate
  dynamically registered MCP clients.
- No Cortex write tools, identity changes, OAuth-store migrations or live
  configuration changes are included.
- Production rollout remains separately approval-gated.

## Verification

Tests must prove the real loopback request contract, fail-closed parsing, secret and
state non-disclosure, authentication/RBAC reuse, and browser rendering of an attacker
client named `Claude` whose redirect URI is `https://evil.example/cb`. Removing the
redirect display or changing text rendering into HTML must make a test fail.

Focused Vitest, `npm run ci:quick`, a production build and Playwright visual/behavior
checks are required before the pull request is presented. A real isolated dev OAuth
connector test remains required after review and before production rollout.
