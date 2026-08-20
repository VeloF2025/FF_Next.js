import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NextApiResponse } from 'next';

import {
  createCortexConsentContextHandler,
  type CortexConsentContextDependencies,
} from '@/pages/api/cortex/mcp-consent-context';

export const VALID_STATE_ID = 'pZJqcS1uZH4fXo0WmXtYyRA7d2NcQk5g';
export const CALLBACK_SECRET = 'context-test-callback-secret';

export interface CapturedContextRequest {
  path: string;
  method: string;
  cortexSecret?: string;
  json: unknown;
}

export interface CapturedContextLog {
  level: 'error' | 'warn' | 'info';
  args: unknown[];
}

export interface ContextHarnessResponse {
  status: number;
  json: {
    success?: boolean;
    data?: Record<string, unknown>;
    error?: { code?: string; message?: string };
  };
}

interface ContextHarnessOptions {
  callbackBase?: string;
  callbackSecret?: string | null;
}

type ContextResponder = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;

const cleanups: Array<() => Promise<void>> = [];

async function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function trackServer(server: http.Server): void {
  cleanups.push(() => new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  }));
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

export async function startContextService(
  responder: ContextResponder,
): Promise<{ url: string; requests: CapturedContextRequest[] }> {
  const requests: CapturedContextRequest[] = [];
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
  const port = await listen(server);
  trackServer(server);
  return { url: `http://127.0.0.1:${port}`, requests };
}

export async function startConsentContextHandler(
  options: ContextHarnessOptions,
): Promise<{
  logs: CapturedContextLog[];
  post(body: Record<string, unknown>): Promise<ContextHarnessResponse>;
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

  const logs: CapturedContextLog[] = [];
  const logger: CortexConsentContextDependencies['logger'] = {
    error: (...args: unknown[]) => logs.push({ level: 'error', args }),
    warn: (...args: unknown[]) => logs.push({ level: 'warn', args }),
  };
  const handler = createCortexConsentContextHandler({ logger });
  const server = http.createServer((request, response) => {
    void (async () => {
      const raw = await readBody(request);
      const req = Object.assign(request, {
        body: raw ? JSON.parse(raw) : undefined,
        query: {},
        cookies: {},
        user: {
          id: 'context-user',
          email: 'reviewer@velocityfibre.co.za',
        },
        sessionId: 'context-session',
      });
      await handler(req as never, nextResponse(response));
    })().catch((error: unknown) => {
      if (!response.headersSent) {
        nextResponse(response).status(500).json({
          success: false,
          error: {
            code: 'HARNESS_ERROR',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    });
  });
  const port = await listen(server);
  trackServer(server);
  return {
    logs,
    async post(body) {
      const response = await fetch(`http://127.0.0.1:${port}/api/cortex/mcp-consent-context`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        json: JSON.parse(await response.text()) as ContextHarnessResponse['json'],
      };
    },
  };
}

export async function closeConsentContextHarnesses(): Promise<void> {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
}
