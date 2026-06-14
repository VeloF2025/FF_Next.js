/**
 * Cortex MCP token — self-serve mint endpoint (Phase 7).
 *
 *   POST /api/cortex/mcp-token  → { token, expiresAt }
 *
 * Mints a long-lived (30-day) per-user Cortex MCP bearer token for the
 * server-verified FibreFlow session user, so they can connect Claude (or any MCP
 * client) to the ACL-aware Cortex brain without an operator. The token carries the
 * user's email (which drives the bridge's per-user ACL narrowing) and the
 * `token_use:"mcp"` revocation marker; it grants no extra privilege.
 *
 * Gated identically to the rest of the Cortex surface in FF (`cortex.review:view`)
 * and behind `CORTEX_MCP_TOKEN_UI_ENABLED`. The flag is the OUTERMOST gate — when
 * off the endpoint 404s for everyone (the in-progress feature is hidden, not just
 * permission-blocked). The identity is ALWAYS `req.user.email` (verified by
 * withAuth) — never a client-supplied value; the gateway secret stays server-side
 * in bridgeAuth.
 */
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withPermission } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { mintMcpToken } from '@/lib/cortex/bridgeAuth';

function mcpTokenUiEnabled(): boolean {
  return (process.env.CORTEX_MCP_TOKEN_UI_ENABLED ?? '').trim().toLowerCase() === 'true';
}

async function postHandler(req: AuthenticatedNextApiRequest, res: NextApiResponse): Promise<void> {
  const { token, expiresAt } = await mintMcpToken(req.user.email);
  // The token is shown once to the user; never logged.
  return apiResponse.success(res, { token, expiresAt });
}

/** Authenticated handler — runs only after withAuth has verified the session. */
const authedHandler = withAuth(async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }
  const authReq = req as AuthenticatedNextApiRequest;
  // Same Cortex gate as /cortex and the query proxy; the bridge then narrows to
  // this user's ACL beneath it.
  return withPermission('cortex.review', 'view')(
    async (r, s) => {
      try {
        await postHandler(r as AuthenticatedNextApiRequest, s);
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
