import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sql: vi.fn().mockResolvedValue([
    { id: 'vehicle-tampered', registration: 'BAD 999 GP' },
  ]),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withFleetAuth:
    (
      handler: (
        req: NextApiRequest & {
          authType: 'portal';
          portalSession: { vehicleId: string };
        },
        res: NextApiResponse
      ) => unknown
    ) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      handler(
        Object.assign(req, {
          authType: 'portal' as const,
          portalSession: { vehicleId: 'vehicle-assigned' },
        }),
        res
      ),
}));

vi.mock('@/lib/api-error-handler', () => ({
  withErrorHandler:
    (
      handler: (req: NextApiRequest, res: NextApiResponse) => unknown
    ) =>
    handler,
}));
vi.mock('@/lib/neon-sql', () => ({
  getSql: () => mocks.sql,
}));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import handler from '../../../../pages/api/fleet/vehicles';

function makeRes(): {
  res: NextApiResponse;
  captured: { status: number; body?: unknown };
} {
  const captured: { status: number; body?: unknown } = { status: 200 };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
    setHeader() {},
  };
  return { res: res as unknown as NextApiResponse, captured };
}

describe('fleet vehicles portal authorization', () => {
  it('rejects vehicle details outside the signed portal session', async () => {
    const { res, captured } = makeRes();
    const req = {
      method: 'GET',
      query: { id: 'vehicle-tampered' },
      headers: {},
    } as unknown as NextApiRequest;

    await handler(req, res);

    expect(captured.status).toBe(403);
    expect(captured.body).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(mocks.sql).not.toHaveBeenCalled();
  });
});
