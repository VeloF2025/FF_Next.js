/**
 * Resolve the registered Cortex OAuth client and redirect destination before
 * FibreFlow lets a signed-in user approve the pending request.
 */
import type { NextApiHandler, NextApiResponse } from 'next';

import { withAuth, withPermission } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { parseCortexMcpConsentContext } from '@/lib/cortex/mcpConsentContext';
import { log } from '@/lib/logger';
import { ffApiGrantEnabled } from '@/lib/cortex/ffApiGrant';

const STATE_ID_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;
const CONTEXT_TIMEOUT_MS = 5_000;
const MAX_CONTEXT_RESPONSE_BYTES = 64 * 1_024;
const GATEWAY_MESSAGE =
  'Authorization details could not be verified. Return to Claude and try connecting again.';
const DEFAULT_SERVICE_URL = 'http://127.0.0.1:7414';

function serviceUrl(): string | null {
  const raw = process.env.CORTEX_REMOTE_MCP_URL || DEFAULT_SERVICE_URL;
  const portText = raw.match(
    /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})(?:\/[^\s?#]*)?$/i,
  )?.[1];
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return raw.replace(/\/$/, '');
}

type ConsentContextLogger = Pick<typeof log, 'error' | 'warn'>;

async function readContextPayload(upstream: Response): Promise<unknown> {
  const declaredLength = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CONTEXT_RESPONSE_BYTES) {
    await upstream.body?.cancel();
    return null;
  }

  const reader = upstream.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let body = '';
  let receivedBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > MAX_CONTEXT_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  return JSON.parse(body) as unknown;
}

export interface CortexConsentContextDependencies {
  logger?: ConsentContextLogger;
}

export function createCortexConsentContextHandler(
  dependencies: CortexConsentContextDependencies = {},
): (
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
) => Promise<void> {
  const logger = dependencies.logger ?? log;

  return async (req, res): Promise<void> => {
    const stateId: unknown = req.body?.stateId;
    if (typeof stateId !== 'string' || !STATE_ID_SHAPE.test(stateId)) {
      return apiResponse.badRequest(res, 'stateId is missing or malformed');
    }

    const secret = (process.env.CORTEX_MCP_CALLBACK_SECRET ?? '').trim();
    if (!secret) {
      logger.error(
        'Cortex MCP context rejected: callback secret is not configured',
        { userId: req.user.id },
        'CortexMcpConsentContext',
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
        'Cortex MCP context rejected: callback URL is invalid',
        { userId: req.user.id },
        'CortexMcpConsentContext',
      );
      return apiResponse.error(
        res,
        ErrorCode.INTERNAL_ERROR,
        GATEWAY_MESSAGE,
      );
    }

    try {
      const upstream = await fetch(`${callbackBase}/authorize/context`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cortex-MCP-Secret': secret,
        },
        body: JSON.stringify({ stateId }),
        signal: AbortSignal.timeout(CONTEXT_TIMEOUT_MS),
        redirect: 'manual',
      });
      if (!upstream.ok) {
        logger.warn(
          'Cortex MCP context refused',
          { userId: req.user.id, status: upstream.status },
          'CortexMcpConsentContext',
        );
        return apiResponse.error(
          res,
          ErrorCode.BAD_GATEWAY,
          GATEWAY_MESSAGE,
        );
      }

      const payload = await readContextPayload(upstream);
      const context = parseCortexMcpConsentContext(payload);
      if (!context) {
        logger.warn(
          'Cortex MCP context response was invalid',
          { userId: req.user.id },
          'CortexMcpConsentContext',
        );
        return apiResponse.error(
          res,
          ErrorCode.BAD_GATEWAY,
          GATEWAY_MESSAGE,
        );
      }
      // The FibreFlow grant is FF's own decision, not part of the context Cortex sends,
      // so it is appended after parsing rather than validated as an upstream field.
      // The consent screen has to state it: with the grant on, the user is agreeing to
      // "Cortex reads anything in FibreFlow I can", not "Cortex reads my meetings".
      return apiResponse.success(res, {
        ...context,
        ffApiGrant: ffApiGrantEnabled(process.env),
      });
    } catch {
      logger.warn(
        'Cortex MCP context unavailable',
        { userId: req.user.id },
        'CortexMcpConsentContext',
      );
      return apiResponse.error(
        res,
        ErrorCode.BAD_GATEWAY,
        GATEWAY_MESSAGE,
      );
    }
  };
}

const contextHandler = createCortexConsentContextHandler();

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
      await contextHandler(
        permissionReq as AuthenticatedNextApiRequest,
        permissionRes,
      );
    },
  )(authReq, res);
});

const handler: NextApiHandler = (req, res) => {
  if (!cortexMcpUiEnabled()) return apiResponse.notFound(res, 'Endpoint');
  return authedHandler(req, res);
};

export default handler;
