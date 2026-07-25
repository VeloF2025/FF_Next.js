/**
 * FibreFlow read-only MCP tokens — self-serve mint + list.
 *
 *   POST /api/me/mcp-tokens  { lifetime?, label? } -> { token, expiresAt }
 *   GET  /api/me/mcp-tokens                        -> { tokens: [...] }
 *
 * Identity is ALWAYS req.user (server-verified by withAuth), never client-supplied.
 * The minted token is returned once and never logged. Available to every authenticated
 * user — the token grants no privilege beyond what that user already has, and is
 * read-only regardless (src/lib/auth/readOnly.ts).
 *
 * POST is mutating, so an MCP token cannot mint another one: minting requires an
 * interactive browser session.
 */
import type { NextApiHandler, NextApiResponse } from 'next';
import { withAuth, getUserSessions } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { McpLifetimeCapError, MCP_LIFETIME_DAYS, mintFfMcpToken } from '@/lib/auth/mcpToken';
import type { McpLifetime } from '@/lib/auth/mcpToken';

const LOGGER = 'MeMcpTokens';
const MAX_LABEL_LENGTH = 60;

function uiEnabled(): boolean {
  return (process.env.FF_MCP_TOKEN_UI_ENABLED ?? '').trim().toLowerCase() === 'true';
}

function isLifetime(v: unknown): v is McpLifetime {
  return typeof v === 'string' && Object.keys(MCP_LIFETIME_DAYS).includes(v);
}

async function listHandler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
): Promise<void> {
  const sessions = await getUserSessions(req.user.id, 'mcp');
  // Deliberately does not project tokenHash — the list must never expose credential
  // material, only the metadata needed to identify and revoke a token.
  return apiResponse.success(res, {
    tokens: sessions.map((s) => ({
      id: s.id,
      label: s.label ?? null,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      lastUsedAt: s.lastUsedAt ?? null,
    })),
  });
}

async function mintHandler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
): Promise<void> {
  const rawLifetime: unknown = req.body?.lifetime ?? '30d';
  if (!isLifetime(rawLifetime)) {
    return apiResponse.badRequest(
      res,
      `lifetime must be one of ${Object.keys(MCP_LIFETIME_DAYS).join(', ')}`
    );
  }

  const rawLabel: unknown = req.body?.label;
  const label =
    typeof rawLabel === 'string' && rawLabel.trim()
      ? rawLabel.trim().slice(0, MAX_LABEL_LENGTH)
      : undefined;

  try {
    const { token, expiresAt, sessionId } = await mintFfMcpToken(req.user, rawLifetime, {
      label,
      ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim(),
      userAgent: req.headers['user-agent'],
    });
    // sessionId is safe to log; the token is not.
    log.info('minted read-only mcp token', {
      userId: req.user.id,
      sessionId,
      lifetime: rawLifetime,
    }, LOGGER);
    return apiResponse.success(res, { token, expiresAt });
  } catch (err) {
    // The dropdown offers 1y to everyone, so a capped owner picking it is a normal
    // user action — answer with a clear 400, not a 500.
    if (err instanceof McpLifetimeCapError) {
      log.warn('mcp token mint rejected: owner lifetime cap', {
        userId: req.user.id,
        lifetime: rawLifetime,
      }, LOGGER);
      return apiResponse.badRequest(res, err.message);
    }
    throw err;
  }
}

const authedHandler = withAuth(async (req, res) => {
  const authReq = req as AuthenticatedNextApiRequest;
  try {
    if (authReq.method === 'GET') {
      await listHandler(authReq, res);
      return;
    }
    if (authReq.method === 'POST') {
      await mintHandler(authReq, res);
      return;
    }
    apiResponse.methodNotAllowed(res, authReq.method ?? 'UNKNOWN', ['GET', 'POST']);
  } catch (err) {
    // withAuth returns the handler promise without awaiting it, so its own try/catch
    // cannot intercept this rejection — fail closed here with structured JSON.
    // Logged here as well as by internalError: this line carries the caller and method,
    // which the generic handler does not have.
    log.error('mcp token request failed', {
      userId: authReq.user?.id,
      method: authReq.method,
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
