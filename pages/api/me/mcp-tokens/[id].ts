/**
 * DELETE /api/me/mcp-tokens/:id -> { revoked: true }
 *
 * Revokes ONE of the caller's own MCP sessions. Ownership is re-checked against the
 * verified user before deletion, so a user can never revoke someone else's token, and
 * a browser session id passed here is refused rather than silently deleted.
 */
import type { NextApiHandler, NextApiResponse } from 'next';
import { withAuth, getSession, deleteSession } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const LOGGER = 'MeMcpTokenRevoke';

function uiEnabled(): boolean {
  return (process.env.FF_MCP_TOKEN_UI_ENABLED ?? '').trim().toLowerCase() === 'true';
}

async function revokeHandler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'DELETE') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['DELETE']);
  }

  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id) {
    return apiResponse.badRequest(res, 'Invalid token id');
  }

  const session = await getSession(id);
  // One message for "not yours", "not an mcp session" and "does not exist" — do not let
  // a caller probe for other users' session ids.
  if (!session || session.userId !== req.user.id || session.kind !== 'mcp') {
    return apiResponse.forbidden(res, 'Token not found or not yours');
  }

  await deleteSession(id);
  log.info('revoked mcp token', { userId: req.user.id, sessionId: id }, LOGGER);
  return apiResponse.success(res, { revoked: true });
}

const authedHandler = withAuth(async (req, res) => {
  const authReq = req as AuthenticatedNextApiRequest;
  try {
    await revokeHandler(authReq, res);
  } catch (err) {
    // withAuth returns the handler promise without awaiting it, so its own try/catch
    // cannot intercept this rejection — fail closed here with structured JSON.
    // Logged here as well as by internalError: this line carries the caller and the
    // session id being revoked, which the generic handler does not have.
    log.error('mcp token revoke failed', {
      userId: authReq.user?.id,
      sessionId: typeof authReq.query.id === 'string' ? authReq.query.id : null,
      error: err instanceof Error ? err.message : String(err),
    }, LOGGER);
    apiResponse.internalError(res, err instanceof Error ? err : new Error(String(err)));
  }
});

const handler: NextApiHandler = (req, res) => {
  // Feature flag is the OUTERMOST gate: when off the endpoint does not exist for
  // anyone (even authenticated users), so the in-progress feature can't be probed.
  if (!uiEnabled()) {
    return apiResponse.notFound(res, 'Endpoint');
  }
  return authedHandler(req, res);
};

export default handler;
