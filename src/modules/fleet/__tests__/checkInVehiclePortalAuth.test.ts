import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkVehicleAvailability: vi.fn(),
  getCheckRecordsForVehicle: vi.fn(),
  getVehicleCheckInStats: vi.fn(),
  getLatestOdometerReading: vi.fn(),
  getLatestFuelLevel: vi.fn(),
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

vi.mock('@/modules/fleet/services/checkInService', () => mocks);
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import handler from '../../../../pages/api/fleet/check-in/vehicle/[vehicleId]';

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

describe('fleet vehicle portal authorization', () => {
  it('rejects reads for a vehicle outside the signed portal session', async () => {
    const { res, captured } = makeRes();
    const req = {
      method: 'GET',
      query: { vehicleId: 'vehicle-tampered', availability: 'true' },
      headers: {},
    } as unknown as NextApiRequest;

    await handler(req, res);

    expect(captured.status).toBe(403);
    expect(captured.body).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(mocks.checkVehicleAvailability).not.toHaveBeenCalled();
  });
});
