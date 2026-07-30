import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sql: vi.fn().mockResolvedValue([]),
  getPhotosForRecord: vi.fn().mockResolvedValue([]),
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

vi.mock('@neondatabase/serverless', () => ({
  neon: () => mocks.sql,
}));
vi.mock('@/modules/fleet/services/checkInService', () => ({
  getPhotosForRecord: mocks.getPhotosForRecord,
  addCheckPhoto: vi.fn(),
}));
vi.mock('@/services/vlmLearningService', () => ({
  recordVlmCorrection: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import handler from '../../../../pages/api/fleet/check-in/photos';

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

describe('fleet check-in photo portal authorization', () => {
  it('rejects a record outside the signed portal vehicle', async () => {
    const { res, captured } = makeRes();
    const req = {
      method: 'GET',
      query: { recordId: 'record-tampered' },
      headers: {},
    } as unknown as NextApiRequest;

    await handler(req, res);

    expect(captured.status).toBe(403);
    expect(captured.body).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(mocks.getPhotosForRecord).not.toHaveBeenCalled();
  });
});
