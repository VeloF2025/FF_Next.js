import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import {
  createCortexConsentHandler,
  type CortexConsentDependencies,
} from '@/pages/api/cortex/mcp-consent';

export const VALID_STATE_ID = 'pZJqcS1uZH4fXo0WmXtYyRA7d2NcQk5g';
export const CALLBACK_SECRET = 'test-callback-secret';
export const MINTED_TOKEN = 'jwt-never-echo';

interface VerifiedUser {
  id: string;
  email: string;
}

interface PermissionBoundary {
  key: string;
  action: string;
  allowed: boolean;
}

export interface CapturedLog {
  level: 'error' | 'warn' | 'info';
  args: unknown[];
}

export interface CapturedCallbackRequest {
  path: string;
  method: string;
  cortexSecret?: string;
  json: unknown;
}

interface JsonBody {
  success?: boolean;
  data?: Record<string, unknown>;
  error?: {
    code?: string;
    message?: string;
  };
  meta?: {
    timestamp?: string;
  };
}

export interface HarnessResponse {
  status: number;
  headers: Headers;
  json: JsonBody;
}

interface ConsentHarnessOptions {
  user?: VerifiedUser | null;
  permission?: PermissionBoundary;
  callbackBase?: string;
  callbackSecret?: string | null;
  mintToken?: CortexConsentDependencies['mintToken'];
  fetchImpl?: CortexConsentDependencies['fetchImpl'];
}

type CallbackResponder = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;

const cleanups: Array<() => Promise<void>> = [];

async function listen(server: http.Server, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function trackServer(server: http.Server): void {
  cleanups.push(
    () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function nextResponse(response: ServerResponse): NextApiResponse {
  const next = Object.assign(response, {
    status(code: number) {
      response.statusCode = code;
      return next;
    },
    json(payload: unknown) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(payload));
      return next;
    },
  });
  return next as unknown as NextApiResponse;
}

function sendBoundaryError(
  response: NextApiResponse,
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).json({
    success: false,
    error: { code, message },
  });
}

export async function startCallbackServer(
  responder: CallbackResponder,
  port = 0,
): Promise<{
  url: string;
  requests: CapturedCallbackRequest[];
}> {
  const requests: CapturedCallbackRequest[] = [];
  const server = http.createServer((request, response) => {
    void (async () => {
      const raw = await readBody(request);
      requests.push({
        path: request.url ?? '',
        method: request.method ?? '',
        cortexSecret: request.headers['x-cortex-mcp-secret'] as string | undefined,
        json: raw ? JSON.parse(raw) : null,
      });
      await responder(request, response);
    })().catch((error: unknown) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    });
  });
  const actualPort = await listen(server, port);
  trackServer(server);
  return {
    url: `http://127.0.0.1:${actualPort}`,
    requests,
  };
}

export async function startConsentHandler(
  options: ConsentHarnessOptions,
): Promise<{
  url: string;
  logs: CapturedLog[];
  post(path: string, body: Record<string, unknown>): Promise<HarnessResponse>;
  get(path: string): Promise<HarnessResponse>;
}> {
  const previousUrl = process.env.CORTEX_REMOTE_MCP_URL;
  const previousSecret = process.env.CORTEX_MCP_CALLBACK_SECRET;
  if (options.callbackBase === undefined) delete process.env.CORTEX_REMOTE_MCP_URL;
  else process.env.CORTEX_REMOTE_MCP_URL = options.callbackBase;
  if (options.callbackSecret === null) delete process.env.CORTEX_MCP_CALLBACK_SECRET;
  else process.env.CORTEX_MCP_CALLBACK_SECRET = options.callbackSecret ?? CALLBACK_SECRET;

  cleanups.push(async () => {
    if (previousUrl === undefined) delete process.env.CORTEX_REMOTE_MCP_URL;
    else process.env.CORTEX_REMOTE_MCP_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CORTEX_MCP_CALLBACK_SECRET;
    else process.env.CORTEX_MCP_CALLBACK_SECRET = previousSecret;
  });

  const logs: CapturedLog[] = [];
  const logger = {
    error: (...args: unknown[]) => logs.push({ level: 'error' as const, args }),
    warn: (...args: unknown[]) => logs.push({ level: 'warn' as const, args }),
    info: (...args: unknown[]) => logs.push({ level: 'info' as const, args }),
  };
  const handler = createCortexConsentHandler({
    mintToken: options.mintToken,
    fetchImpl: options.fetchImpl,
    logger,
  });
  const user = options.user === undefined
    ? { id: 'user-1', email: 'reviewer@velocityfibre.co.za' }
    : options.user;
  const permission = options.permission ?? {
    key: 'cortex.review',
    action: 'view',
    allowed: true,
  };

  const server = http.createServer((request, response) => {
    void (async () => {
      const res = nextResponse(response);
      const bodyText = await readBody(request);
      const body = bodyText ? JSON.parse(bodyText) : undefined;
      if (!user) {
        return sendBoundaryError(res, 401, 'UNAUTHORIZED', 'Authentication required');
      }
      const req = Object.assign(request, {
        body,
        query: {},
        cookies: {},
        user,
        sessionId: 'test-session',
      });
      if (request.method !== 'POST') {
        return apiResponse.methodNotAllowed(res, request.method ?? 'UNKNOWN', ['POST']);
      }
      if (
        permission.key !== 'cortex.review'
        || permission.action !== 'view'
        || !permission.allowed
      ) {
        return sendBoundaryError(
          res,
          403,
          'FORBIDDEN',
          'Missing required permission: cortex.review',
        );
      }
      await handler(req as never, res);
    })().catch((error: unknown) => {
      if (!response.headersSent) {
        nextResponse(response).status(500).json({
          success: false,
          error: {
            code: 'HARNESS_ERROR',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      } else {
        response.destroy(error instanceof Error ? error : undefined);
      }
    });
  });
  const port = await listen(server);
  trackServer(server);
  const url = `http://127.0.0.1:${port}`;

  async function request(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<HarnessResponse> {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      headers: response.headers,
      json: JSON.parse(await response.text()) as JsonBody,
    };
  }

  return {
    url,
    logs,
    post: (path, body) => request('POST', path, body),
    get: (path) => request('GET', path),
  };
}

export async function closeConsentHarnesses(): Promise<void> {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
}
