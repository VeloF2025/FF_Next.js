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
const mintMcpToken = vi.fn(async (email: string) => ({
  token: `tok-for-${email}`,
  expiresAt: '2026-07-14T00:00:00.000Z',
}));
vi.mock('@/lib/cortex/bridgeAuth', () => ({
  mintMcpToken: (email: string) => mintMcpToken(email),
}));

// Import AFTER mocks are registered.
import handler from '../mcp-token';

let saved: string | undefined;

beforeEach(() => {
  saved = process.env.CORTEX_MCP_TOKEN_UI_ENABLED;
  principal.authenticated = true;
  principal.email = 'reviewer@velocityfibre.co.za';
  principal.grantedActions = new Set<string>(['view']);
  mintMcpToken.mockClear();
});

afterEach(() => {
  if (saved === undefined) delete process.env.CORTEX_MCP_TOKEN_UI_ENABLED;
  else process.env.CORTEX_MCP_TOKEN_UI_ENABLED = saved;
});

function run(method: 'GET' | 'POST') {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method });
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

  it('200s and returns the token minted for the VERIFIED session email', async () => {
    principal.email = 'alice@velocityfibre.co.za';
    const { res, done } = run('POST');
    await done;
    expect(res._getStatusCode()).toBe(200);
    const body = res._getJSONData();
    expect(body.success).toBe(true);
    expect(body.data.token).toBe('tok-for-alice@velocityfibre.co.za');
    expect(body.data.expiresAt).toBe('2026-07-14T00:00:00.000Z');
    // Identity binding: minted for the session email, exactly once.
    expect(mintMcpToken).toHaveBeenCalledTimes(1);
    expect(mintMcpToken).toHaveBeenCalledWith('alice@velocityfibre.co.za');
  });
});
