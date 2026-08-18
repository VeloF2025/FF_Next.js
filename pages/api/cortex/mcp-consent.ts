/**
 * Cortex connector consent — binds a verified FibreFlow identity to a pending
 * Cortex MCP OAuth request without exposing the minted bearer to the browser.
 */
import type { NextApiHandler, NextApiResponse } from 'next';

import { withAuth, withPermission } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { mintMcpToken } from '@/lib/cortex/bridgeAuth';
import { mintFfMcpToken } from '@/lib/auth/mcpToken';
import { deleteSession, getUserSessions } from '@/lib/auth/session';
import { ffApiGrantEnabled, ffGrantLifetime } from '@/lib/cortex/ffApiGrant';
import { log } from '@/lib/logger';

const STATE_ID_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;
const CALLBACK_TIMEOUT_MS = 10_000;
const GATEWAY_MESSAGE =
  'Authorization could not be completed. Return to Claude and try connecting again.';
const DEFAULT_SERVICE_URL = 'http://127.0.0.1:7414';

function serviceUrl(): string | null {
  const raw = process.env.CORTEX_REMOTE_MCP_URL || DEFAULT_SERVICE_URL;
  const portText = raw.match(
    /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})(?:\/[^\s?#]*)?$/i,
  )?.[1];
  const port = Number(portText);
  if (
    !Number.isInteger(port)
    || port < 1
    || port > 65_535
  ) {
    return null;
  }
  return raw.replace(/\/$/, '');
}

function isSafeRedirect(value: unknown): value is string {
  return (
    typeof value === 'string'
    && /^https?:\/\/[^/\s?#]+(?:[/?#]\S*)?$/i.test(value)
  );
}

type MintToken = (
  email: string,
  lifetime: '90d',
) => Promise<{ token: string; expiresAt: unknown }>;

type ConsentLogger = Pick<typeof log, 'error' | 'warn' | 'info'>;

/**
 * Mints the FibreFlow-side credential. Injected like mintToken so the consent flow can
 * be driven in a test without reaching a real `user_sessions` row.
 */
type MintFfToken = typeof mintFfMcpToken;

export interface CortexConsentDependencies {
  mintToken?: MintToken;
  mintFfToken?: MintFfToken;
  /** Injected so orphan cleanup and the active-token cap are testable without a DB. */
  deleteSession?: typeof deleteSession;
  listSessions?: typeof getUserSessions;
  fetchImpl?: typeof fetch;
  logger?: ConsentLogger;
  /** Defaults to process.env; injected so the grant flag can be exercised directly. */
  env?: Record<string, string | undefined>;
}

/**
 * The bridge token below is minted at 90 days, so the FibreFlow credential issued
 * alongside it matches rather than outliving the connection it belongs to.
 */
const CONSENT_LIFETIME = '90d' as const;

/**
 * Same cap as pages/api/me/mcp-tokens.ts, for the same reason: without it a browser
 * session can mint long-lived credentials in a loop. The authorize page retries on
 * error, so a flaky upstream would otherwise accumulate live 90-day tokens.
 */
const MAX_ACTIVE_TOKENS = 10;

/**
 * Behind nginx on the same host, req.socket.remoteAddress is always 127.0.0.1, which
 * makes the audit column useless. Both sibling mints read the forwarded header.
 */
function firstForwardedFor(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.split(',')[0]?.trim() || undefined;
}

/**
 * Delete a FibreFlow credential whose grant did not complete.
 *
 * The token is minted BEFORE the upstream call, because Cortex needs it in the request
 * body. If that call then fails, the row is a live 90-day credential that no OAuth grant
 * points at — invisible to its owner and, worse, possibly already received by Cortex
 * while FibreFlow's own logs say the authorization failed. The sibling route
 * pages/api/mcp/consent.ts states the rule its header calls non-negotiable: an orphan is
 * worse than a failed authorization.
 *
 * If the delete ITSELF fails there is nothing left to do but say so loudly, with the
 * session id, so it can be revoked by hand.
 */
async function revokeOrphanedGrant(
  sessionId: string | undefined,
  userId: string,
  logger: ConsentLogger,
  remove: typeof deleteSession,
): Promise<void> {
  if (!sessionId) return;
  try {
    await remove(sessionId);
  } catch (error) {
    logger.error(
      'ORPHANED FIBREFLOW GRANT: Cortex consent failed and cleanup failed — revoke manually',
      {
        sessionId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      },
      'CortexMcpConsent',
    );
  }
}

export function createCortexConsentHandler(
  dependencies: CortexConsentDependencies = {},
): (
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
) => Promise<void> {
  const mintToken = dependencies.mintToken ?? mintMcpToken;
  const mintFfToken = dependencies.mintFfToken ?? mintFfMcpToken;
  const removeSession = dependencies.deleteSession ?? deleteSession;
  const listSessions = dependencies.listSessions ?? getUserSessions;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const logger = dependencies.logger ?? log;
  const env = dependencies.env ?? process.env;

  return async (req, res): Promise<void> => {
    // Declared OUTSIDE the try so the catch below can revoke it. An exception thrown
    // after the mint — anywhere, including inside apiResponse — would otherwise leave the
    // same orphaned credential the 502 path is careful to clean up.
    let ffSessionId: string | undefined;
    try {
      const stateId: unknown = req.body?.stateId;
      if (typeof stateId !== 'string' || !STATE_ID_SHAPE.test(stateId)) {
        return apiResponse.badRequest(res, 'stateId is missing or malformed');
      }

      const secret = (process.env.CORTEX_MCP_CALLBACK_SECRET ?? '').trim();
      if (!secret) {
        logger.error(
          'Cortex MCP consent rejected: callback secret is not configured',
          { userId: req.user.id },
          'CortexMcpConsent',
        );
        return apiResponse.error(
          res,
          ErrorCode.INTERNAL_ERROR,
          GATEWAY_MESSAGE,
        );
      }

      const callbackBase = serviceUrl();
      if (!callbackBase) {
        logger.error(
          'Cortex MCP consent rejected: callback URL is invalid',
          { userId: req.user.id },
          'CortexMcpConsent',
        );
        return apiResponse.error(
          res,
          ErrorCode.INTERNAL_ERROR,
          GATEWAY_MESSAGE,
        );
      }

      const { token } = await mintToken(req.user.email, CONSENT_LIFETIME);

      // The FibreFlow-side credential, issued only when the grant is switched on.
      //
      // read-only by construction (withAuth/requireAuth enforce it), bound to a
      // revocable user_sessions row, and re-reading is_active and permissions on every
      // request — so it carries the user's LIVE permissions rather than a snapshot, and
      // deactivating them kills it on the next call rather than at expiry.
      //
      // req.user, never a client-supplied identity: this route is behind withAuth and
      // the whole point of the grant is that Cortex acts as the person who authorised it.
      let ffToken: string | undefined;
      if (ffApiGrantEnabled(env)) {
        const active = await listSessions(req.user.id, 'mcp');
        if (active.length >= MAX_ACTIVE_TOKENS) {
          logger.warn(
            'Cortex FibreFlow grant rejected: active token cap',
            { userId: req.user.id, active: active.length },
            'CortexMcpConsent',
          );
          return apiResponse.badRequest(
            res,
            `You already have ${active.length} active read-only FibreFlow tokens (limit `
              + `${MAX_ACTIVE_TOKENS}). Revoke one before connecting again.`,
          );
        }

        const minted = await mintFfToken(req.user, ffGrantLifetime(CONSENT_LIFETIME), {
          label: 'Cortex connector',
          ipAddress: firstForwardedFor(req.headers['x-forwarded-for']),
          userAgent: req.headers['user-agent'],
        });
        ffToken = minted.token;
        // Kept so the token can be revoked if the grant does not complete. Without it a
        // failed authorization leaves a live credential with no id to revoke by.
        ffSessionId = minted.sessionId;
      }

      let redirectUrl: unknown;
      try {
        const upstream = await fetchImpl(`${callbackBase}/authorize/complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Cortex-MCP-Secret': secret,
          },
          // ffToken is omitted entirely when the grant is off — JSON.stringify drops an
          // undefined value, so Cortex sees no key rather than a null it might store.
          body: JSON.stringify({ stateId, token, ffToken }),
          signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
          redirect: 'manual',
        });
        if (upstream.ok) {
          const payload: unknown = await upstream.json().catch(() => {
            logger.warn(
              'Cortex MCP consent callback returned invalid JSON',
              { userId: req.user.id },
              'CortexMcpConsent',
            );
            return null;
          });
          redirectUrl = (
            payload as { redirectUrl?: unknown } | null
          )?.redirectUrl;
        } else {
          logger.warn(
            'Cortex MCP consent callback refused',
            { userId: req.user.id, status: upstream.status },
            'CortexMcpConsent',
          );
        }
      } catch (error) {
        logger.warn(
          'Cortex MCP consent callback unavailable',
          {
            userId: req.user.id,
            error: error instanceof Error ? error.message : String(error),
          },
          'CortexMcpConsent',
        );
      }

      if (!isSafeRedirect(redirectUrl)) {
        // Every upstream failure — unreachable, refused, bad JSON, unsafe redirect —
        // funnels here, so this is the one place the orphan has to be cleaned up.
        await revokeOrphanedGrant(ffSessionId, req.user.id, logger, removeSession);
        return apiResponse.error(
          res,
          ErrorCode.BAD_GATEWAY,
          GATEWAY_MESSAGE,
        );
      }
      logger.info(
        'Cortex MCP consent granted',
        // sessionId so a leaked credential can be traced back to the grant that made it.
        { userId: req.user.id, ffSessionId },
        'CortexMcpConsent',
      );
      return apiResponse.success(res, { redirectUrl });
    } catch (error) {
      await revokeOrphanedGrant(ffSessionId, req.user.id, logger, removeSession);
      logger.error(
        'Cortex MCP consent request failed',
        { userId: req.user.id },
        'CortexMcpConsent',
      );
      return apiResponse.internalError(
        res,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  };
}

const consentHandler = createCortexConsentHandler();

/**
 * Same outermost gate as pages/api/cortex/mcp-token.ts. Both routes mint the
 * identical Cortex bearer, so gating one and not the other would let consent
 * hand out a credential the kill switch is supposed to have turned off.
 */
function cortexMcpUiEnabled(): boolean {
  return (process.env.CORTEX_MCP_TOKEN_UI_ENABLED ?? '').trim().toLowerCase() === 'true';
}

const authedHandler: NextApiHandler = withAuth(async (req, res) => {
  const authReq = req as AuthenticatedNextApiRequest;
  if (authReq.method !== 'POST') {
    return apiResponse.methodNotAllowed(
      res,
      authReq.method ?? 'UNKNOWN',
      ['POST'],
    );
  }
  return withPermission('cortex.review', 'view')(
    async (permissionReq, permissionRes) => {
      await consentHandler(
        permissionReq as AuthenticatedNextApiRequest,
        permissionRes,
      );
    },
  )(authReq, res);
});

const handler: NextApiHandler = (req, res) => {
  if (!cortexMcpUiEnabled()) {
    return apiResponse.notFound(res, 'Endpoint');
  }
  return authedHandler(req, res);
};

export default handler;
