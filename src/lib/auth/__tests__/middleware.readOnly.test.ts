/**
 * Regression tests for the read-only MCP gate at the WRAPPER level.
 *
 * `readOnly.test.ts` covers the predicate in isolation. These tests cover the wiring:
 * an `mcp` session must be refused by every wrapper that resolves a user, and the
 * wrapped handler must never run. `withFleetAuth` shipped without the gate once
 * (11 mutating fleet routes were writable with a read-only token), so it is pinned here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sqlMock, verifyTokenMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  verifyTokenMock: vi.fn(),
}));

vi.mock('@/lib/db-neon', () => ({ neon: () => sqlMock }));
vi.mock('../jwt', () => ({ verifyToken: verifyTokenMock }));
// last_used_at tracking is fire-and-forget and irrelevant here.
vi.mock('../sessionUsage', () => ({ touchSessionUsage: vi.fn() }));

import { withAuth, withFleetAuth, withOptionalAuth } from '../middleware';

const SESSION_ROW = (kind: string) => [
  {
    id: 'u1',
    email: 'a@x.co',
    first_name: 'A',
    last_name: 'B',
    role: 'viewer',
    permissions: [],
    is_active: true,
    profile_picture: null,
    department: null,
    session_id: 's1',
    is_impersonation: false,
    kind,
  },
];

interface MockRes {
  statusCode: number | null;
  body: unknown;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
  setHeader: () => void;
}

const makeRes = (): MockRes => {
  const r: MockRes = {
    statusCode: null,
    body: null,
    status(c) {
      r.statusCode = c;
      return r;
    },
    json(b) {
      r.body = b;
      return r;
    },
    setHeader() {
      /* not asserted */
    },
  };
  return r;
};

const makeReq = (method: string): NextApiRequest =>
  ({
    method,
    cookies: { ff_auth_token: 'a.b.c' },
    headers: {},
    query: {},
  }) as unknown as NextApiRequest;

const run = async (
  wrapped: (req: NextApiRequest, res: NextApiResponse) => unknown,
  method: string
) => {
  const res = makeRes();
  await wrapped(makeReq(method), res as unknown as NextApiResponse);
  return res;
};

describe('read-only gate wiring in the auth wrappers', () => {
  let handler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = vi.fn((_req: NextApiRequest, res: NextApiResponse) => res.status(200).json({ ok: true }));
    verifyTokenMock.mockResolvedValue({ sub: 'u1', sessionId: 's1', email: 'a@x.co', role: 'viewer' });
  });

  describe.each([
    ['withAuth', withAuth],
    ['withFleetAuth', withFleetAuth],
    ['withOptionalAuth', withOptionalAuth],
  ] as const)('%s', (_name, wrapper) => {
    it('refuses a mutating request from an mcp session and never runs the handler', async () => {
      sqlMock.mockResolvedValue(SESSION_ROW('mcp'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await run((wrapper as any)(handler), 'POST');
      expect(res.statusCode).toBe(403);
      expect((res.body as { error: { code: string } }).error.code).toBe('MCP_READ_ONLY');
      expect(handler).not.toHaveBeenCalled();
    });

    it('allows a GET from an mcp session', async () => {
      sqlMock.mockResolvedValue(SESSION_ROW('mcp'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await run((wrapper as any)(handler), 'GET');
      expect(res.statusCode).toBe(200);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('allows a mutating request from a browser session', async () => {
      sqlMock.mockResolvedValue(SESSION_ROW('browser'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await run((wrapper as any)(handler), 'POST');
      expect(res.statusCode).toBe(200);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
