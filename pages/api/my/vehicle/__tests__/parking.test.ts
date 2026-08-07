import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const SESSION = { staffId: 'staff-1', staffName: 'Thabo M' };

vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession:
    (handler: (req: NextApiRequest, res: NextApiResponse, s: unknown) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      handler(req, res, SESSION),
}));

const resolveDriverVehicle = vi.fn();
const loadDriverParkingState = vi.fn();
const insertPendingDeclaration = vi.fn();
const withdrawPendingDeclaration = vi.fn();
vi.mock('@/modules/fleet/parking/driverParkingQueries', () => ({
  PENDING_CONFLICT: 'ux_parking_pending_per_vehicle',
  resolveDriverVehicle: (...a: unknown[]) => resolveDriverVehicle(...a),
  loadDriverParkingState: (...a: unknown[]) => loadDriverParkingState(...a),
  insertPendingDeclaration: (...a: unknown[]) => insertPendingDeclaration(...a),
  withdrawPendingDeclaration: (...a: unknown[]) => withdrawPendingDeclaration(...a),
}));

const notifyParkingChangeRequested = vi.fn();
vi.mock('@/modules/fleet/parking/parkingNotifications', () => ({
  notifyParkingChangeRequested: (...a: unknown[]) => notifyParkingChangeRequested(...a),
}));

const reverseGeocode = vi.fn();
vi.mock('@/utils/geoLocation', () => ({
  reverseGeocode: (...a: unknown[]) => reverseGeocode(...a),
}));

import handler from '../parking';

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader() {
      return this;
    },
    end() {
      return this;
    },
  };
  return res as unknown as NextApiResponse & { statusCode: number; body: unknown };
}

function call(req: Partial<NextApiRequest>) {
  const res = mockRes();
  return Promise.resolve(handler(req as NextApiRequest, res)).then(() => res);
}

const VEHICLE = { vehicleId: 'veh-1', registration: 'LN40MGGP' };
const GOOD_BODY = { lat: -26.2041, lon: 28.0473, accuracyM: 12 };
const DECLARATION = { id: 'loc-1', status: 'pending' };

beforeEach(() => {
  resolveDriverVehicle.mockReset().mockResolvedValue(VEHICLE);
  loadDriverParkingState.mockReset().mockResolvedValue({
    active: null,
    pending: null,
    history: [],
  });
  insertPendingDeclaration.mockReset().mockResolvedValue(DECLARATION);
  withdrawPendingDeclaration.mockReset().mockResolvedValue(true);
  notifyParkingChangeRequested.mockReset().mockResolvedValue(undefined);
  reverseGeocode.mockReset().mockResolvedValue({ city: 'Johannesburg', province: 'Gauteng' });
});

describe('GET /api/my/vehicle/parking', () => {
  it('returns the vehicle and its declarations', async () => {
    loadDriverParkingState.mockResolvedValue({ active: { id: 'a' }, pending: null, history: [] });
    const res = await call({ method: 'GET' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { vehicle: { id: 'veh-1', registration: 'LN40MGGP' }, active: { id: 'a' } },
    });
  });

  it('404s when the caller has no active vehicle', async () => {
    resolveDriverVehicle.mockResolvedValue(null);
    const res = await call({ method: 'GET' });
    expect(res.statusCode).toBe(404);
    expect(loadDriverParkingState).not.toHaveBeenCalled();
  });
});

describe('POST /api/my/vehicle/parking', () => {
  it('stores a valid capture as pending and notifies approvers', async () => {
    const res = await call({ method: 'POST', body: GOOD_BODY });
    expect(res.statusCode).toBe(201);
    expect(insertPendingDeclaration).toHaveBeenCalledTimes(1);
    expect(insertPendingDeclaration.mock.calls[0]![0]).toMatchObject({
      vehicleId: 'veh-1',
      staffId: 'staff-1',
      lat: -26.2041,
      lon: 28.0473,
    });
    expect(notifyParkingChangeRequested).toHaveBeenCalledTimes(1);
  });

  /**
   * The security property of the whole route. A driver must not be able to
   * declare a parking address for someone else's vehicle by naming it in the
   * body — the same hole closed for the fleet portal on 2026-07-30.
   */
  it('ignores a vehicleId supplied in the body', async () => {
    const res = await call({
      method: 'POST',
      body: { ...GOOD_BODY, vehicleId: 'someone-elses-vehicle' },
    });
    expect(res.statusCode).toBe(201);
    expect(insertPendingDeclaration.mock.calls[0]![0].vehicleId).toBe('veh-1');
  });

  it('ignores a staffId supplied in the body', async () => {
    await call({ method: 'POST', body: { ...GOOD_BODY, staffId: 'someone-else' } });
    expect(insertPendingDeclaration.mock.calls[0]![0].staffId).toBe('staff-1');
  });

  it('rejects a capture that is too inaccurate', async () => {
    const res = await call({ method: 'POST', body: { ...GOOD_BODY, accuracyM: 250 } });
    expect(res.statusCode).toBe(400);
    expect(insertPendingDeclaration).not.toHaveBeenCalled();
  });

  it('rejects invalid coordinates', async () => {
    const res = await call({ method: 'POST', body: { ...GOOD_BODY, lat: 'somewhere' } });
    expect(res.statusCode).toBe(400);
    expect(insertPendingDeclaration).not.toHaveBeenCalled();
  });

  it('rejects a request with no body at all', async () => {
    const res = await call({ method: 'POST' });
    expect(res.statusCode).toBe(400);
    expect(insertPendingDeclaration).not.toHaveBeenCalled();
  });

  it('404s when the caller has no active vehicle', async () => {
    resolveDriverVehicle.mockResolvedValue(null);
    const res = await call({ method: 'POST', body: GOOD_BODY });
    expect(res.statusCode).toBe(404);
    expect(insertPendingDeclaration).not.toHaveBeenCalled();
  });

  // The partial unique index is the authority on "one open request", not an
  // application pre-check that two rapid taps can both pass.
  it('turns the pending-conflict 23505 into a 409', async () => {
    insertPendingDeclaration.mockRejectedValue(
      Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'ux_parking_pending_per_vehicle',
      })
    );
    const res = await call({ method: 'POST', body: GOOD_BODY });
    expect(res.statusCode).toBe(409);
  });

  it('still 500s on an unrelated database error', async () => {
    insertPendingDeclaration.mockRejectedValue(new Error('connection reset'));
    const res = await call({ method: 'POST', body: GOOD_BODY });
    expect(res.statusCode).toBe(500);
  });

  // Spec §11: a failed reverse geocode stores coordinates anyway.
  it('stores the declaration when reverse geocoding fails', async () => {
    reverseGeocode.mockResolvedValue(null);
    const res = await call({ method: 'POST', body: GOOD_BODY });
    expect(res.statusCode).toBe(201);
    expect(insertPendingDeclaration.mock.calls[0]![0].addressText).toBeNull();
  });

  it('stores the declaration when reverse geocoding throws', async () => {
    reverseGeocode.mockRejectedValue(new Error('nominatim down'));
    const res = await call({ method: 'POST', body: GOOD_BODY });
    expect(res.statusCode).toBe(201);
    expect(insertPendingDeclaration.mock.calls[0]![0].addressText).toBeNull();
  });
});

describe('DELETE /api/my/vehicle/parking', () => {
  it('withdraws the open request', async () => {
    const res = await call({ method: 'DELETE' });
    expect(res.statusCode).toBe(200);
    expect(withdrawPendingDeclaration).toHaveBeenCalledWith('veh-1', 'staff-1');
  });

  it('404s when there is nothing to withdraw', async () => {
    withdrawPendingDeclaration.mockResolvedValue(false);
    const res = await call({ method: 'DELETE' });
    expect(res.statusCode).toBe(404);
  });
});

describe('method handling', () => {
  it('rejects an unsupported method', async () => {
    const res = await call({ method: 'PUT', body: {} });
    expect(res.statusCode).toBe(405);
    expect(resolveDriverVehicle).not.toHaveBeenCalled();
  });
});
