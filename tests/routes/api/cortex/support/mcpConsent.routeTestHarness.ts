import crypto from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NextApiHandler, NextApiResponse } from 'next';

import { ConsentRouteDatabase } from './mcpConsent.routeDatabase';

export { ConsentRouteDatabase } from './mcpConsent.routeDatabase';

interface RouteJson {
  success?: boolean;
  data?: {
    redirectUrl?: string;
    clientId?: string;
    clientName?: string | null;
    redirectUri?: string;
    scopes?: string[];
  };
  error?: {
    code?: string;
    message?: string;
  };
}

export interface RouteResponse {
  status: number;
  headers: Headers;
  json: RouteJson;
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

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function requestCookies(request: IncomingMessage): Record<string, string> {
  const raw = request.headers.cookie;
  if (!raw) return {};
  return Object.fromEntries(raw.split(';').map((part) => {
    const [name, ...value] = part.trim().split('=');
    return [name ?? '', value.join('=')];
  }));
}

async function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

export async function startRealConsentRoute(
  routeKind: 'complete' | 'context' = 'complete',
): Promise<{
  database: ConsentRouteDatabase;
  callback: {
    count: number;
    stateId?: string;
    hasJwt?: boolean;
    authenticatedSecret?: boolean;
    path?: string;
  };
  request(method: 'GET' | 'POST', authenticated: boolean): Promise<RouteResponse>;
  close(): Promise<void>;
}> {
  const previous = {
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    nextPhase: process.env.NEXT_PHASE,
    callbackUrl: process.env.CORTEX_REMOTE_MCP_URL,
    callbackSecret: process.env.CORTEX_MCP_CALLBACK_SECRET,
    bridgeSecret: process.env.BRIDGE_JWT_SECRET,
  };
  process.env.DATABASE_URL = 'postgresql://route:route@database.invalid:5432/route';
  process.env.JWT_SECRET = 'route-test-jwt-secret-at-least-32-characters';
  process.env.NEXT_PHASE = 'phase-production-build';

  const callbackSecret = 'route-test-callback-secret';
  const callback = {
    count: 0,
    stateId: undefined as string | undefined,
    hasJwt: undefined as boolean | undefined,
    authenticatedSecret: undefined as boolean | undefined,
    path: undefined as string | undefined,
  };
  const callbackServer = http.createServer((request, response) => {
    void (async () => {
      const body = JSON.parse(await readBody(request)) as {
        stateId?: string;
        token?: string;
      };
      callback.count += 1;
      callback.path = request.url;
      callback.stateId = body.stateId;
      callback.hasJwt = body.token?.split('.').length === 3;
      callback.authenticatedSecret =
        request.headers['x-cortex-mcp-secret'] === callbackSecret;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(
        routeKind === 'context'
          ? {
              client_id: 'route-client',
              client_name: 'Claude',
              redirect_uri: 'https://evil.example/route-callback',
              scopes: ['cortex.read'],
            }
          : { redirectUrl: 'https://claude.ai/mcp/callback?code=route-test' },
      ));
    })().catch((error: unknown) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    });
  });
  const callbackPort = await listen(callbackServer);
  process.env.CORTEX_REMOTE_MCP_URL = `http://127.0.0.1:${callbackPort}`;
  process.env.CORTEX_MCP_CALLBACK_SECRET = callbackSecret;
  process.env.BRIDGE_JWT_SECRET =
    'route-test-bridge-secret-at-least-32-characters';

  const database = new ConsentRouteDatabase();
  const serverless = await import('@neondatabase/serverless');
  const previousFetchFunction = serverless.neonConfig.fetchFunction;
  serverless.neonConfig.fetchFunction = database.fetch;
  const { signToken } = await import('@/lib/auth');
  const token = await signToken({
    id: 'route-user',
    userId: 'route-user',
    email: 'route.user@velocityfibre.co.za',
    firstName: 'Route',
    lastName: 'User',
    name: 'Route User',
    role: 'admin',
    permissions: [],
    isActive: true,
  }, 'route-session', '1h');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const handler: NextApiHandler = routeKind === 'context'
    ? (await import('@/pages/api/cortex/mcp-consent-context')).default
    : (await import('@/pages/api/cortex/mcp-consent')).default;
  const routePath = routeKind === 'context'
    ? '/api/cortex/mcp-consent-context'
    : '/api/cortex/mcp-consent';

  const server = http.createServer((request, response) => {
    void (async () => {
      const rawBody = await readBody(request);
      const nextReq = Object.assign(request, {
        body: rawBody ? JSON.parse(rawBody) : undefined,
        cookies: requestCookies(request),
        query: {},
      });
      await handler(nextReq as never, nextResponse(response));
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
  const url = `http://127.0.0.1:${port}`;

  async function routeRequest(
    method: 'GET' | 'POST',
    authenticated: boolean,
  ): Promise<RouteResponse> {
    const response = await fetch(`${url}${routePath}`, {
      method,
      headers: {
        ...(authenticated ? { cookie: `ff_auth_token=${token}` } : {}),
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      body: method === 'POST'
        ? JSON.stringify({ stateId: 'pZJqcS1uZH4fXo0WmXtYyRA7d2NcQk5g' })
        : undefined,
    });
    return {
      status: response.status,
      headers: response.headers,
      json: JSON.parse(await response.text()) as RouteJson,
    };
  }

  return {
    database,
    callback,
    request: routeRequest,
    async close() {
      await Promise.all([server, callbackServer].map((openServer) =>
        new Promise<void>((resolve) => {
          openServer.close(() => resolve());
          openServer.closeAllConnections();
        })));
      serverless.neonConfig.fetchFunction = previousFetchFunction;
      const { pool } = await import('@/lib/db');
      await pool.end();
      if (previous.databaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous.databaseUrl;
      if (previous.jwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previous.jwtSecret;
      if (previous.nextPhase === undefined) delete process.env.NEXT_PHASE;
      else process.env.NEXT_PHASE = previous.nextPhase;
      if (previous.callbackUrl === undefined) {
        delete process.env.CORTEX_REMOTE_MCP_URL;
      } else process.env.CORTEX_REMOTE_MCP_URL = previous.callbackUrl;
      if (previous.callbackSecret === undefined) {
        delete process.env.CORTEX_MCP_CALLBACK_SECRET;
      } else process.env.CORTEX_MCP_CALLBACK_SECRET = previous.callbackSecret;
      if (previous.bridgeSecret === undefined) delete process.env.BRIDGE_JWT_SECRET;
      else process.env.BRIDGE_JWT_SECRET = previous.bridgeSecret;
      if (
        database.queries[0]?.params[2] !== tokenHash
        && database.queries.length > 0
      ) {
        throw new Error('Real auth query did not carry the signed token hash');
      }
    },
  };
}
