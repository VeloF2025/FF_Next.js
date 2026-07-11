/**
 * Cortex MCP token — self-serve mint + revoke (Phase 7).
 *
 *   POST   /api/cortex/mcp-token  → { token, expiresAt }   (mint a token; body.lifetime
 *                                                           in '30d'|'90d'|'1y', default '30d')
 *   DELETE /api/cortex/mcp-token  → { revoked: true }       (revoke ALL my MCP tokens)
 *
 * Mint issues a per-user Cortex MCP bearer token for the server-verified FF session
 * user (identity is ALWAYS req.user.email — never client-supplied), valid for the
 * requested lifetime. The token carries the user's email (which drives the bridge's
 * per-user ACL narrowing), a unique `jti`, and the `token_use:"mcp"` revocation
 * marker; it grants no extra privilege. Super-admin emails are capped at 90 days by
 * `mintMcpToken` itself. `never` is intentionally NOT offered here yet (Phase gate —
 * see ALLOWED_LIFETIMES below) even though the lib layer supports it.
 *
 * Revoke calls the bridge's self-authorizing /api/mcp-tokens/revoke with a
 * short-lived, UNMARKED per-user gateway JWT (bridgeBearer) — the bridge revokes the
 * email IN that verified token, so a user can only revoke their OWN tokens. Revoke
 * sets the user's min_iat epoch to now, so every existing MCP token they hold then
 * 401s at the bridge (a token minted afterwards survives).
 *
 * Gated identically to the rest of the Cortex surface in FF (`cortex.review:view`)
 * and behind `CORTEX_MCP_TOKEN_UI_ENABLED` (outermost gate → 404 hides the feature).
 * The gateway secret stays server-side in bridgeAuth.
 */
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withPermission } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { McpLifetimeCapError, bridgeBearer, mintMcpToken } from '@/lib/cortex/bridgeAuth';
import type { Lifetime } from '@/lib/cortex/bridgeAuth';
import { fetchWithTimeout } from '@/lib/cortex/meetingReviewLogic';

const BRIDGE_URL = process.env.CORTEX_BRIDGE_URL ?? 'http://localhost:7403';

function mcpTokenUiEnabled(): boolean {
  return (process.env.CORTEX_MCP_TOKEN_UI_ENABLED ?? '').trim().toLowerCase() === 'true';
}

// PHASE GATE: `never` is fully supported at the mintMcpToken/LIFETIME_DAYS level
// (unit-tested), but not offered here yet — a later phase adds it once the admin
// safety-net (revocation UI, audit trail) exists. Keep in sync with the dropdown.
const ALLOWED_LIFETIMES = ['30d', '90d', '1y'] as const satisfies ReadonlyArray<
  Exclude<Lifetime, 'never'>
>;

function isAllowedLifetime(v: unknown): v is (typeof ALLOWED_LIFETIMES)[number] {
  return typeof v === 'string' && (ALLOWED_LIFETIMES as readonly string[]).includes(v);
}

async function postHandler(req: AuthenticatedNextApiRequest, res: NextApiResponse): Promise<void> {
  const raw: unknown = req.body?.lifetime ?? '30d';
  if (!isAllowedLifetime(raw)) {
    return apiResponse.badRequest(res, `lifetime must be one of ${ALLOWED_LIFETIMES.join(', ')}`);
  }
  try {
    const { token, expiresAt } = await mintMcpToken(req.user.email, raw);
    // The token is shown once to the user; never logged.
    return apiResponse.success(res, { token, expiresAt });
  } catch (err) {
    // The dropdown offers `1y` to everyone, so a capped super-admin picking it is a
    // normal user action — answer with a clear 400, not the generic 500 below.
    if (err instanceof McpLifetimeCapError) {
      log.warn('MCP token mint rejected: super-admin lifetime cap', { lifetime: raw }, 'cortex-mcp-token');
      return apiResponse.badRequest(res, err.message);
    }
    throw err;
  }
}

async function deleteHandler(req: AuthenticatedNextApiRequest, res: NextApiResponse): Promise<void> {
  // Fail LOUD (symmetric with mintMcpToken) rather than letting bridgeBearer fall
  // back to the broad CORTEX_API_KEY service credential: a per-user revoke must be
  // authorized by a per-user token, never a tenant-wide one.
  if (!process.env.BRIDGE_JWT_SECRET) {
    throw new Error('bridgeAuth: BRIDGE_JWT_SECRET is not set — cannot revoke MCP tokens');
  }
  // Self-authorize the revoke with a short-lived, UNMARKED per-user gateway JWT.
  // bridgeBearer mints a token_use-less 5-minute HS256 token for this verified user,
  // so (a) the bridge revokes only THIS user's email (read from the token), and
  // (b) this auth token is itself never epoch-subject (no token_use:"mcp" marker).
  const bearer = await bridgeBearer(req.user.email);
  const upstream = await fetchWithTimeout(fetch, `${BRIDGE_URL}/api/mcp-tokens/revoke`, {
    method: 'POST',
    headers: {
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      'X-Cortex-Reviewer': req.user.email,
    },
  });
  if (!upstream.ok) {
    // Upstream non-OK is not a proxy crash — surface as 5xx with context.
    return apiResponse.internalError(res, new Error(`Bridge ${upstream.status}`));
  }
  return apiResponse.success(res, { revoked: true });
}

/** Authenticated handler — runs only after withAuth has verified the session. */
const authedHandler = withAuth(async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {
  const method = req.method ?? 'UNKNOWN';
  if (method !== 'POST' && method !== 'DELETE') {
    return apiResponse.methodNotAllowed(res, method, ['POST', 'DELETE']);
  }
  const authReq = req as AuthenticatedNextApiRequest;
  // Same Cortex gate as /cortex and the query proxy; the bridge then narrows to
  // this user's ACL beneath it. Mint and self-revoke are both view-tier (a user
  // managing their own access is not a privileged operation over others).
  return withPermission('cortex.review', 'view')(
    async (r, s) => {
      const ar = r as AuthenticatedNextApiRequest;
      try {
        if (ar.method === 'DELETE') {
          await deleteHandler(ar, s);
        } else {
          await postHandler(ar, s);
        }
      } catch (err) {
        // apiResponse.internalError logs the error itself — no second log here.
        apiResponse.internalError(s, err instanceof Error ? err : new Error(String(err)));
      }
    },
  )(authReq, res);
});

const handler: NextApiHandler = (req, res) => {
  // Feature flag is the OUTERMOST gate: when off the endpoint does not exist for
  // anyone (even authenticated users), so the in-progress feature can't be probed.
  if (!mcpTokenUiEnabled()) {
    return apiResponse.notFound(res, 'Endpoint');
  }
  return authedHandler(req, res);
};

export default handler;
