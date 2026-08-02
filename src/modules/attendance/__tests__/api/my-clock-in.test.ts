import type { NextApiRequest } from 'next';
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

describe('POST /api/my/attendance/clock-in request guards', () => {
  it('401s when session is invalid', async () => {
    mocks.verifySession.mockResolvedValue({ valid: false, session: null, reason: 'no_cookie_or_bad_signature' });
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -26.27, lon: 27.95, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(401);
  });

  it('405s on GET', async () => {
    const req = { method: 'GET', headers: {}, socket: {}, query: {} } as unknown as NextApiRequest;
    const { res, captured } = makeRes();
    await handler(req, res);
    expect(captured.statusCode).toBe(405);
  });

  it('400s on missing / invalid lat/lon', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(400);
  });

  it('400s on invalid client_occurred_at', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: 0, lon: 0, client_occurred_at: 'not-an-iso-date', selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(400);
  });

  it('400s on missing selfie_base64', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: 0, lon: 0, client_occurred_at: nowIso() }),
      res
    );
    expect(captured.statusCode).toBe(400);
  });

  it('403s + consent_required when selfie consent revoked', async () => {
    mocks.getSelfieConsentState.mockResolvedValue('revoked');
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -26.27, lon: 27.95, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(403);
    const body = captured.body as { error?: { details?: { reason?: string; consentState?: string } } };
    expect(body.error?.details?.reason).toBe('consent_required');
    expect(body.error?.details?.consentState).toBe('revoked');
  });

  it('403s with honest message when credentials row is missing', async () => {
    mocks.getSelfieConsentState.mockResolvedValue('missing');
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -26.27, lon: 27.95, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(403);
    const body = captured.body as { error?: { message?: string; details?: { consentState?: string } } };
    expect(body.error?.details?.consentState).toBe('missing');
    expect(body.error?.message?.toLowerCase()).toMatch(/not set up|contact hr/);
  });

  it('409s + open_entry when an open entry already exists', async () => {
    mocks.findOpenEntry.mockResolvedValue({
      id: 'entry-already-open',
      work_date: '2026-04-19',
      clock_in_at: new Date(Date.now() - 20 * 3600_000).toISOString(),
      status: 'open',
    });
    const { res, captured } = makeRes();
    await handler(
      makeReq({ lat: -26.27, lon: 27.95, client_occurred_at: nowIso(), selfie_base64: FAKE_SELFIE }),
      res
    );
    expect(captured.statusCode).toBe(409);
    const body = captured.body as { error?: { details?: { reason?: string; openEntryId?: string } } };
    expect(body.error?.details?.reason).toBe('open_entry');
    expect(body.error?.details?.openEntryId).toBe('entry-already-open');
  });

  it('returns prior_correction_required before creating a new clock-in', async () => {
    mocks.findRequiredAttendanceAction.mockResolvedValue({
      exceptionId: 'exception-prior-day',
      entryId: 'entry-prior-day',
      workDate: '2026-04-19',
      kind: 'missing_clock_out',
      provisionalPaidHours: 8,
      clockInAt: '2026-04-19T06:00:00.000Z',
    });
    const { res, captured } = makeRes();

    await handler(
      makeReq({
        lat: -26.27,
        lon: 27.95,
        client_occurred_at: nowIso(),
        selfie_base64: FAKE_SELFIE,
      }),
      res
    );

    expect(captured.statusCode).toBe(409);
    expect(captured.body).toMatchObject({
      error: {
        details: {
          reason: 'prior_correction_required',
          exceptionId: 'exception-prior-day',
        },
      },
    });
    expect(mocks.storeSelfie).not.toHaveBeenCalled();
    expect(mocks.insertClockIn).not.toHaveBeenCalled();
  });

  it('allows clock-in after correction submission while review is pending', async () => {
    mocks.findRequiredAttendanceAction.mockResolvedValue(null);
    const { res, captured } = makeRes();

    await handler(
      makeReq({
        lat: -26.27,
        lon: 27.95,
        client_occurred_at: nowIso(),
        selfie_base64: FAKE_SELFIE,
      }),
      res
    );

    expect(captured.statusCode).toBe(200);
    expect(mocks.insertClockIn).toHaveBeenCalledTimes(1);
  });
});
