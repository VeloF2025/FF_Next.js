/**
 * Route-handler tests for POST /api/cortex/mcp-token (self-serve MCP token mint).
 *
 * Drives the real exported handler through node-mocks-http with the auth + signer
 * seams mocked, proving:
 *   (a) flag off  → 404 for everyone, and the token is never minted;
 *   (b) flag on, unauthenticated → 401 (withAuth), token never minted;
 *   (c) flag on, authed but lacking cortex.review:view → 403, token never minted;
 *   (d) flag on, authed + permission, POST → 200 with { token, expiresAt }, and the
 *       token is minted for the VERIFIED session email (never a client value);
 *   (e) wrong method → 405.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

// ── Controllable auth principal (per-test) ──────────────────────────────────────
const principal = {
  authenticated: true,
  email: 'reviewer@velocityfibre.co.za',
  grantedActions: new Set<string>(['view']),
};

vi.mock('@/lib/auth', () => ({
  // withAuth: 401 when no session, else inject the verified user (real middleware contract).
  withAuth: (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) => {
      if (!principal.authenticated) {
        return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED' } });
      }
      (req as unknown as { user: { email: string } }).user = { email: principal.email };
      return handler(req, res);
    },
  withPermission: (_perm: string, action: 'view' | 'create' | 'edit' | 'delete' = 'view') =>
    (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) =>
      (req: NextApiRequest, res: NextApiResponse) => {
        if (!principal.grantedActions.has(action)) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Missing required permission: cortex.review' },
          });
        }
        return handler(req, res);
      },
}));

// ── Signer seam: assert identity binding without real crypto ─────────────────────
const mintMcpToken = vi.fn(async (email: string, _lifetime?: string) => ({
  token: `tok-for-${email}`,
  expiresAt: '2026-07-14T00:00:00.000Z',
}));
const bridgeBearer = vi.fn(async (_email: string) => 'self-auth-bearer');
// Spread the real module so McpLifetimeCapError stays the SAME class the route
// imports — the handler's `instanceof` mapping to 400 is exercised for real.
vi.mock('@/lib/cortex/bridgeAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cortex/bridgeAuth')>()),
  mintMcpToken: (email: string, lifetime?: string) => mintMcpToken(email, lifetime),
  bridgeBearer: (email: string) => bridgeBearer(email),
}));

// ── Bridge call seam (revoke): control the upstream response ────────────────────
const fetchWithTimeout = vi.fn(
  async (..._args: unknown[]) => ({ ok: true, status: 200 }) as Partial<Response>,
);
vi.mock('@/lib/cortex/meetingReviewLogic', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
}));

// Import AFTER mocks are registered.
import handler from '../mcp-token';
import { McpLifetimeCapError } from '@/lib/cortex/bridgeAuth';

let saved: string | undefined;
let savedSecret: string | undefined;

beforeEach(() => {
  saved = process.env.CORTEX_MCP_TOKEN_UI_ENABLED;
  savedSecret = process.env.BRIDGE_JWT_SECRET;
  principal.authenticated = true;
  principal.email = 'reviewer@velocityfibre.co.za';
  principal.grantedActions = new Set<string>(['view']);
  mintMcpToken.mockClear();
  bridgeBearer.mockClear();
  fetchWithTimeout.mockClear();
  fetchWithTimeout.mockResolvedValue({ ok: true, status: 200 } as Partial<Response>);
});

afterEach(() => {
  if (saved === undefined) delete process.env.CORTEX_MCP_TOKEN_UI_ENABLED;
  else process.env.CORTEX_MCP_TOKEN_UI_ENABLED = saved;
  if (savedSecret === undefined) delete process.env.BRIDGE_JWT_SECRET;
  else process.env.BRIDGE_JWT_SECRET = savedSecret;
});

function run(method: 'GET' | 'POST' | 'DELETE', body?: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method, body });
  return { req, res, done: handler(req, res) };
}

describe('POST /api/cortex/mcp-token — feature flag', () => {
  it('404s for everyone when CORTEX_MCP_TOKEN_UI_ENABLED is off, and never mints', async () => {
    delete process.env.CORTEX_MCP_TOKEN_UI_ENABLED;
    const { res, done } = run('POST');
    await done;
    expect(res._getStatusCode()).toBe(404);
    expect(mintMcpToken).not.toHaveBeenCalled();
  });
});

describe('POST /api/cortex/mcp-token — auth + permission (flag on)', () => {
  beforeEach(() => {
    process.env.CORTEX_MCP_TOKEN_UI_ENABLED = 'true';
  });

  it('401s when unauthenticated, and never mints', async () => {
    principal.authenticated = false;
    const { res, done } = run('POST');
    await done;
    expect(res._getStatusCode()).toBe(401);
    expect(mintMcpToken).not.toHaveBeenCalled();
  });

  it('403s when the user lacks cortex.review:view, and never mints', async () => {
    principal.grantedActions = new Set<string>();
    const { res, done } = run('POST');
    await done;
    expect(res._getStatusCode()).toBe(403);
    expect(mintMcpToken).not.toHaveBeenCalled();
  });

  it('405s on a non-POST method', async () => {
    const { res, done } = run('GET');
    await done;
    expect(res._getStatusCode()).toBe(405);
    expect(mintMcpToken).not.toHaveBeenCalled();
  });

  it('200s and returns the token minted for the VERIFIED session email, defaulting lifetime to 30d', async () => {
    principal.email = 'alice@velocityfibre.co.za';
    const { res, done } = run('POST');
    await done;
    expect(res._getStatusCode()).toBe(200);
    const body = res._getJSONData();
    expect(body.success).toBe(true);
    expect(body.data.token).toBe('tok-for-alice@velocityfibre.co.za');
    expect(body.data.expiresAt).toBe('2026-07-14T00:00:00.000Z');
    // Identity binding: minted for the session email, exactly once, default lifetime.
    expect(mintMcpToken).toHaveBeenCalledTimes(1);
    expect(mintMcpToken).toHaveBeenCalledWith('alice@velocityfibre.co.za', '30d');
  });

  it.each(['30d', '90d', '1y'] as const)(
    '200s and passes lifetime %s through to mintMcpToken',
    async (lifetime) => {
      principal.email = 'alice@velocityfibre.co.za';
      const { res, done } = run('POST', { lifetime });
      await done;
      expect(res._getStatusCode()).toBe(200);
      expect(mintMcpToken).toHaveBeenCalledWith('alice@velocityfibre.co.za', lifetime);
    },
  );

  it('400s on an invalid lifetime value, and never mints', async () => {
    const { res, done } = run('POST', { lifetime: 'forever' });
    await done;
    expect(res._getStatusCode()).toBe(400);
    expect(mintMcpToken).not.toHaveBeenCalled();
  });

  it('400s on "never" — not offered at the endpoint yet (phase gate), and never mints', async () => {
    const { res, done } = run('POST', { lifetime: 'never' });
    await done;
    expect(res._getStatusCode()).toBe(400);
    expect(mintMcpToken).not.toHaveBeenCalled();
  });

  it('400s on a non-string lifetime, and never mints', async () => {
    const { res, done } = run('POST', { lifetime: 365 });
    await done;
    expect(res._getStatusCode()).toBe(400);
    expect(mintMcpToken).not.toHaveBeenCalled();
  });

  it('400s with the cap message (not a 500) when a super-admin requests "1y"', async () => {
    // The UI offers "1 year" to everyone; mintMcpToken enforces the 90-day cap for
    // super-admins by throwing McpLifetimeCapError. The route must answer 400.
    mintMcpToken.mockRejectedValueOnce(new McpLifetimeCapError());
    const { res, done } = run('POST', { lifetime: '1y' });
    await done;
    expect(res._getStatusCode()).toBe(400);
    const body = res._getJSONData();
    expect(body.success).toBe(false);
    expect(body.error.message).toMatch(/capped at 90 days/);
  });

  it('500s (generic) when the mint fails for any other reason', async () => {
    mintMcpToken.mockRejectedValueOnce(new Error('BRIDGE_JWT_SECRET is not set'));
    const { res, done } = run('POST', { lifetime: '30d' });
    await done;
    expect(res._getStatusCode()).toBe(500);
  });
});

describe('DELETE /api/cortex/mcp-token — revoke (flag on)', () => {
  beforeEach(() => {
    process.env.CORTEX_MCP_TOKEN_UI_ENABLED = 'true';
    process.env.BRIDGE_JWT_SECRET = 'test-bridge-secret-value-0123456789';
  });

  it('404s when the flag is off, and never calls the bridge', async () => {
    delete process.env.CORTEX_MCP_TOKEN_UI_ENABLED;
    const { res, done } = run('DELETE');
    await done;
    expect(res._getStatusCode()).toBe(404);
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('401s when unauthenticated, and never calls the bridge', async () => {
    principal.authenticated = false;
    const { res, done } = run('DELETE');
    await done;
    expect(res._getStatusCode()).toBe(401);
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('403s when the user lacks cortex.review:view, and never calls the bridge', async () => {
    principal.grantedActions = new Set<string>();
    const { res, done } = run('DELETE');
    await done;
    expect(res._getStatusCode()).toBe(403);
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('200s and calls the bridge revoke with a self-auth bearer for the verified user', async () => {
    principal.email = 'alice@velocityfibre.co.za';
    const { res, done } = run('DELETE');
    await done;
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().data).toEqual({ revoked: true });
    // Self-auth bearer minted for the verified session email.
    expect(bridgeBearer).toHaveBeenCalledWith('alice@velocityfibre.co.za');
    // Bridge revoke endpoint hit via POST with that bearer + reviewer attribution.
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    const [, url, opts] = fetchWithTimeout.mock.calls[0] as unknown as [unknown, string, RequestInit];
    expect(url).toMatch(/\/api\/mcp-tokens\/revoke$/);
    expect(opts.method).toBe('POST');
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer self-auth-bearer');
    expect((opts.headers as Record<string, string>)['X-Cortex-Reviewer']).toBe(
      'alice@velocityfibre.co.za',
    );
  });

  it('500s when the bridge revoke returns non-OK', async () => {
    fetchWithTimeout.mockResolvedValue({ ok: false, status: 502 } as Partial<Response>);
    const { res, done } = run('DELETE');
    await done;
    expect(res._getStatusCode()).toBe(500);
  });

  it('500s (fail loud) when BRIDGE_JWT_SECRET is unset, and never calls the bridge', async () => {
    delete process.env.BRIDGE_JWT_SECRET;
    const { res, done } = run('DELETE');
    await done;
    expect(res._getStatusCode()).toBe(500);
    // Must not fall back to a broad service credential for a per-user revoke.
    expect(fetchWithTimeout).not.toHaveBeenCalled();
    expect(bridgeBearer).not.toHaveBeenCalled();
  });
});
