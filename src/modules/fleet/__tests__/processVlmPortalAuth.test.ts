import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  extractOdometerReading: vi.fn(),
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

vi.mock('@/lib/db-neon', () => ({ neon: () => vi.fn() }));
vi.mock('@/modules/fleet/services/fleetVlmService', () => ({
  extractOdometerReading: mocks.extractOdometerReading,
  verifyLicensePlate: vi.fn(),
  extractFuelLevel: vi.fn(),
  checkFleetVlmHealth: vi.fn(),
  validateOdometerReading: vi.fn(),
}));
vi.mock('@/modules/fleet/services/checkInService', () => ({
  recordOdometerReading: vi.fn(),
  recordFuelLevel: vi.fn(),
  getLatestOdometerReading: vi.fn(),
}));
vi.mock('@/services/vlmLearningService', () => ({
  recordVlmCorrection: vi.fn(),
  recordCorrectExtraction: vi.fn(),
}));
vi.mock('@/lib/vlm', () => ({ VLM_FLEET_MODEL: 'test-model' }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import handler from '../../../../pages/api/fleet/check-in/process-vlm';

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

describe('fleet VLM portal authorization', () => {
  it('rejects processing for a vehicle outside the signed portal session', async () => {
    const { res, captured } = makeRes();
    const req = {
      method: 'POST',
      query: {},
      headers: {},
      body: {
        photoId: 'temp-dashboard',
        recordId: 'pending',
        vehicleId: 'vehicle-tampered',
        analysisType: 'odometer',
        base64Image: 'data:image/jpeg;base64,test',
      },
    } as unknown as NextApiRequest;

    await handler(req, res);

    expect(captured.status).toBe(403);
    expect(captured.body).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(mocks.extractOdometerReading).not.toHaveBeenCalled();
  });
});
