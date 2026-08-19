import { beforeEach, describe, expect, it } from 'vitest';

import {
  FAKE_SELFIE,
  handler,
  makeReq,
  makeRes,
  mocks,
  nowIso,
  resetClockInMocks,
} from './my-clock-in.testUtils';

beforeEach(resetClockInMocks);

describe('POST /api/my/attendance/clock-in finalization', () => {
  it('400s + clock_skew when device time is >2 min off', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        lat: -26.27,
        lon: 27.95,
        client_occurred_at: nowIso(-10 * 60_000),
        selfie_base64: FAKE_SELFIE,
      }),
      res
    );
    expect(captured.statusCode).toBe(400);
    const body = captured.body as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe('clock_skew');
  });

  it('200s on the happy path and returns entry + site info', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        lat: -26.27,
        lon: 27.95,
        accuracy_m: 12,
        client_occurred_at: nowIso(),
        selfie_base64: FAKE_SELFIE,
      }),
      res
    );
    expect(captured.statusCode).toBe(200);
    expect(mocks.storeSelfie).toHaveBeenCalled();
    expect(mocks.insertClockIn).toHaveBeenCalled();
    const body = captured.body as { success: true; data: { entryId: string; siteId: string; insideSite: boolean } };
    expect(body.data.entryId).toBe('entry-999');
    expect(body.data.siteId).toBe('project-789');
    expect(body.data.insideSite).toBe(true);
    expect(mocks.insertException).not.toHaveBeenCalled();
  });

  it('does NOT flag a miss smaller than the device error', async () => {
    // A fix 20 m outside a hull on a receiver accurate to +/-50 m is
    // indistinguishable from being inside. Flagging it manufactures a
    // violation the data cannot support — GPS accuracy on these entries
    // averages 37 m and reaches 1,543 m.
    mocks.matchGeofence.mockResolvedValue({
      projectId: 'project-789', projectName: 'Lawley',
      distanceM: 20, inside: false, withinAccuracy: true,
    });
    const { res, captured } = makeRes();
    await handler(makeReq({
      lat: -26.27, lon: 27.95, accuracy_m: 50,
      client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE,
    }), res);
    expect(captured.statusCode).toBe(200);
    const kinds = mocks.insertException.mock.calls.map((c) => (c[0] as { kind: string }).kind);
    expect(kinds).not.toContain('geofence_mismatch');
  });

  it('files a low-accuracy fix under its own kind, not geofence_mismatch', async () => {
    // 236 of the 2,497 queued exceptions were low-accuracy warnings wearing
    // the geofence label, which is why the queue could not be triaged.
    mocks.matchGeofence.mockResolvedValue({
      projectId: 'project-789', projectName: 'Lawley',
      distanceM: 0, inside: true, withinAccuracy: false,
    });
    const { res, captured } = makeRes();
    await handler(makeReq({
      lat: -26.27, lon: 27.95, accuracy_m: 900,
      client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE,
    }), res);
    expect(captured.statusCode).toBe(200);
    const kinds = mocks.insertException.mock.calls.map((c) => (c[0] as { kind: string }).kind);
    expect(kinds).toContain('low_accuracy');
    expect(kinds).not.toContain('geofence_mismatch');
  });

  it('logs geofence_mismatch when GPS is outside any radius', async () => {
    mocks.matchGeofence.mockResolvedValue({
      projectId: null,
      projectName: null,
      distanceM: null,
      inside: false,
      withinAccuracy: false,
    });
    mocks.insertClockIn.mockResolvedValue({
      id: 'entry-nomatch',
      staff_id: 'staff-456',
      work_date: '2026-04-20',
      clock_in_at: new Date().toISOString(),
      clock_out_at: null,
      clock_in_lat: '0',
      clock_in_lon: '0',
      clock_in_accuracy_m: null,
      clock_out_lat: null,
      clock_out_lon: null,
      clock_out_accuracy_m: null,
      selfie_in_url: '/storage/x',
      selfie_out_url: null,
      vehicle_assignment_id: null,
      site_geofence_id: null,
      status: 'open',
      notes: null,
    });
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: 0, lon: 0, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(200);
    expect(mocks.insertException).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'geofence_mismatch', entryId: 'entry-nomatch', severity: 'warning' })
    );
  });

  it('uploads selfie BEFORE calling insertClockIn (ordering contract)', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -26.27, lon: 27.95, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(200);
    const uploadOrder = mocks.storeSelfie.mock.invocationCallOrder[0]!;
    const insertOrder = mocks.insertClockIn.mock.invocationCallOrder[0]!;
    expect(uploadOrder).toBeLessThan(insertOrder);
  });

  it('does NOT call insertClockIn when selfie upload fails', async () => {
    mocks.storeSelfie.mockRejectedValueOnce(new Error('VF Storage down'));
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -26.27, lon: 27.95, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(500);
    expect(mocks.insertClockIn).not.toHaveBeenCalled();
  });

  it('returns 409 + raced=true when INSERT hits unique-violation (23505)', async () => {
    const pgErr = Object.assign(new Error('duplicate key'), { code: '23505' });
    mocks.insertClockIn.mockRejectedValueOnce(pgErr);
    mocks.findOpenEntry
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'entry-winner',
        work_date: '2026-04-20',
        clock_in_at: new Date().toISOString(),
        status: 'open',
      });

    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -26.27, lon: 27.95, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(409);
    const body = captured.body as {
      error?: { details?: { reason?: string; raced?: boolean; openEntryId?: string } };
    };
    expect(body.error?.details?.reason).toBe('open_entry');
    expect(body.error?.details?.raced).toBe(true);
    expect(body.error?.details?.openEntryId).toBe('entry-winner');
  });

  it('logs low_accuracy exception when accuracy_m > 100', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        lat: -26.27,
        lon: 27.95,
        accuracy_m: 250,
        client_occurred_at: nowIso(),
        selfie_base64: FAKE_SELFIE,
      }),
      res
    );
    expect(captured.statusCode).toBe(200);
    const calls = mocks.insertException.mock.calls.map((c: unknown[]) => c[0]);
    const lowAcc = calls.find(
      (c) => (c as { details?: { reason?: string } }).details?.reason === 'low_accuracy'
    );
    expect(lowAcc).toBeDefined();
  });
});
