import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  syncOfflineCheckRecord: vi.fn(),
  checkSyncStatus: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withFleetAuth:
    (
      handler: (
        req: NextApiRequest & {
          authType: 'portal';
          portalSession: {
            vehicleId: string;
            driverId: string;
            driverName: string;
          };
        },
        res: NextApiResponse
      ) => unknown
    ) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      handler(
        Object.assign(req, {
          authType: 'portal' as const,
          portalSession: {
            vehicleId: 'vehicle-assigned',
            driverId: 'staff-1',
            driverName: 'Assigned Driver',
          },
        }),
        res
      ),
}));

vi.mock('@/modules/fleet/services/checkInService', () => mocks);
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import handler from '../../../../pages/api/fleet/check-in/sync';

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fleet offline sync portal authorization', () => {
  it('rejects a synced check for a vehicle outside the signed portal session', async () => {
    const { res, captured } = makeRes();
    const req = {
      method: 'POST',
      query: {},
      headers: {},
      body: {
        offlineId: 'offline-1',
        vehicleId: 'vehicle-tampered',
        driverId: 'staff-tampered',
        driverName: 'Tampered Driver',
      },
    } as unknown as NextApiRequest;

    await handler(req, res);

    expect(captured.status).toBe(403);
    expect(captured.body).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(mocks.syncOfflineCheckRecord).not.toHaveBeenCalled();
  });
});
