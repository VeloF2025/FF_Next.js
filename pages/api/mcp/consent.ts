/**
 * Connector consent API — the trust boundary between a FibreFlow login and the
 * remote MCP service.
 *
 *   POST /api/mcp/consent  { stateId } -> { redirectUrl }
 *
 * Called by pages/mcp/authorize.tsx when the signed-in user clicks Allow. Mints a
 * read-only MCP token for the VERIFIED req.user (never a client-supplied identity)
 * and hands it to the local MCP service's /authorize/complete callback, which binds
 * it to the pending OAuth state. The token itself never reaches the browser.
 *
 * The route is POST-only, so a kind='mcp' session can never call it — the read-only
 * gate refuses mutating methods. Minting a connector grant therefore requires an
 * interactive login, by construction.
 *
 * Failure contract: if the callback does not fully succeed, the session minted here
 * is deleted before responding. A token no OAuth grant points at is a live credential
 * invisible to its owner, so an orphan is worse than a failed authorization.
 */
import type { NextApiResponse } from 'next';
import { withAuth, deleteSession } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { mintFfMcpToken } from '@/lib/auth/mcpToken';

const LOGGER = 'McpConsent';

// The service generates state ids with secrets.token_urlsafe(24) (32 base64url chars);
// the range is deliberately wider so a service-side change doesn't break consent.
const STATE_ID_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

const CALLBACK_TIMEOUT_MS = 10_000;

const serviceUrl = (): string =>
  (process.env.FF_REMOTE_MCP_URL || 'http://127.0.0.1:7416').replace(/\/$/, '');

function badGateway(res: NextApiResponse): void {
  res.status(502).json({
    success: false,
    error: {
      code: 'BAD_GATEWAY',
      message: 'Authorization could not be completed. Return to Claude and try connecting again.',
    },
  });
}

async function consentHandler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
): Promise<void> {
  const stateId: unknown = req.body?.stateId;
  if (typeof stateId !== 'string' || !STATE_ID_SHAPE.test(stateId)) {
    return apiResponse.badRequest(res, 'stateId is missing or malformed');
  }

  const secret = (process.env.FF_MCP_CALLBACK_SECRET ?? '').trim();
  if (!secret) {
    // Config fault, not a user error — and minting before discovering it would only
    // create a session we immediately have to delete.
    log.error('mcp consent rejected: FF_MCP_CALLBACK_SECRET is not configured', {}, LOGGER);
    return badGateway(res);
  }

  const { token, sessionId } = await mintFfMcpToken(req.user, '90d', {
    label: 'Claude connector',
    ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim(),
    userAgent: req.headers['user-agent'],
  });

  let redirectUrl: unknown;
  try {
    const upstream = await fetch(`${serviceUrl()}/authorize/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ff-mcp-secret': secret },
      body: JSON.stringify({ stateId, token }),
      signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
    });
    if (upstream.ok) {
      const payload: unknown = await upstream.json().catch(() => null);
      redirectUrl = (payload as { redirectUrl?: unknown } | null)?.redirectUrl;
    } else {
      log.warn('mcp consent callback refused', { status: upstream.status, sessionId }, LOGGER);
    }
  } catch (err) {
    log.warn('mcp consent callback unreachable', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    }, LOGGER);
  }

  if (typeof redirectUrl !== 'string' || !redirectUrl) {
    try {
      await deleteSession(sessionId);
    } catch (err) {
      // The one state this endpoint must never create silently: a live token with no
      // grant. Loud log with the session id so it can be revoked by hand.
      log.error('ORPHANED MCP SESSION: consent failed and cleanup failed — revoke manually', {
        sessionId,
        userId: req.user.id,
        error: err instanceof Error ? err.message : String(err),
      }, LOGGER);
    }
    return badGateway(res);
  }

  log.info('mcp consent granted', { userId: req.user.id, sessionId }, LOGGER);
  return apiResponse.success(res, { redirectUrl });
}

export default withAuth(async (req, res) => {
  const authReq = req as AuthenticatedNextApiRequest;
  if (authReq.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, authReq.method ?? 'UNKNOWN', ['POST']);
  }
  try {
    await consentHandler(authReq, res);
  } catch (err) {
    // withAuth returns the handler promise without awaiting it, so its own try/catch
    // cannot intercept this rejection — fail closed here with structured JSON.
    log.error('mcp consent request failed', {
      userId: authReq.user?.id,
      error: err instanceof Error ? err.message : String(err),
    }, LOGGER);
    apiResponse.internalError(res, err instanceof Error ? err : new Error(String(err)));
  }
});
