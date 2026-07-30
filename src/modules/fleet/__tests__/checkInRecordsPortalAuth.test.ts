import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createCheckRecord: vi.fn(),
  getCheckRecords: vi.fn(),
  getFleetCheckInStats: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withFleetAuth:
    (
      handler: (
        req: NextApiRequest & {
          authType: 'portal';
          portalSession: {
            sessionId: string;
            vehicleId: string;
            vehicleRegistration: string;
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
            sessionId: 'portal-session-1',
            vehicleId: 'vehicle-assigned',
            vehicleRegistration: 'ABC 123 GP',
            driverId: 'staff-1',
            driverName: 'Assigned Driver',
          },
        }),
        res
      ),
}));

vi.mock('@/modules/fleet/services/checkInService', () => ({
  createCheckRecord: mocks.createCheckRecord,
  getCheckRecords: mocks.getCheckRecords,
  getFleetCheckInStats: mocks.getFleetCheckInStats,
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import handler from '../../../../pages/api/fleet/check-in/records';

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

function makePost(body: Record<string, unknown>): NextApiRequest {
  return {
    method: 'POST',
    query: {},
    headers: {},
    body: {
      vehicleId: 'vehicle-assigned',
      driverId: 'staff-1',
      driverName: 'Assigned Driver',
      checkType: 'daily',
      responses: [],
      ...body,
    },
  } as NextApiRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createCheckRecord.mockImplementation(async (input) => ({
    id: 'record-1',
    ...input,
  }));
});

describe('fleet check-in portal authorization', () => {
  it('rejects a portal submission for a vehicle outside the signed session', async () => {
    const { res, captured } = makeRes();

    await handler(makePost({ vehicleId: 'vehicle-tampered' }), res);

    expect(captured.status).toBe(403);
    expect(captured.body).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(mocks.createCheckRecord).not.toHaveBeenCalled();
  });

  it('uses the signed portal driver identity instead of submitted identity fields', async () => {
    const { res, captured } = makeRes();

    await handler(
      makePost({
        driverId: 'staff-tampered',
        driverName: 'Tampered Driver',
      }),
      res
    );

    expect(captured.status).toBe(201);
    expect(captured.body).toMatchObject({
      success: true,
      data: {
        vehicleId: 'vehicle-assigned',
        driverId: 'staff-1',
        driverName: 'Assigned Driver',
      },
    });
  });
});
