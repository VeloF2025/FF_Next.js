/**
 * Cortex connector consent — binds a verified FibreFlow identity to a pending
 * Cortex MCP OAuth request without exposing the minted bearer to the browser.
 */
import type { NextApiHandler, NextApiResponse } from 'next';

import { withAuth, withPermission } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { mintMcpToken } from '@/lib/cortex/bridgeAuth';
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

export interface CortexConsentDependencies {
  mintToken?: MintToken;
  fetchImpl?: typeof fetch;
  logger?: ConsentLogger;
}

export function createCortexConsentHandler(
  dependencies: CortexConsentDependencies = {},
): (
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
) => Promise<void> {
  const mintToken = dependencies.mintToken ?? mintMcpToken;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const logger = dependencies.logger ?? log;

  return async (req, res): Promise<void> => {
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

      const { token } = await mintToken(req.user.email, '90d');
      let redirectUrl: unknown;
      try {
        const upstream = await fetchImpl(`${callbackBase}/authorize/complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Cortex-MCP-Secret': secret,
          },
          body: JSON.stringify({ stateId, token }),
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
        return apiResponse.error(
          res,
          ErrorCode.BAD_GATEWAY,
          GATEWAY_MESSAGE,
        );
      }
      logger.info(
        'Cortex MCP consent granted',
        { userId: req.user.id },
        'CortexMcpConsent',
      );
      return apiResponse.success(res, { redirectUrl });
    } catch (error) {
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
