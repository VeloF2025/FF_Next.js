import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getCorrectionTarget,
  getCurrentAttendance,
  submitRequiredAttendanceCorrection,
} from '../attendanceStateApi';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('attendanceStateApi', () => {
  it('resolves the exact exception-only correction target', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { correctionTarget: { exceptionId: 'ex/one', entryId: 'en-1' } },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getCorrectionTarget('ex/one')).resolves.toEqual({
      exceptionId: 'ex/one', entryId: 'en-1',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/my/attendance-corrections?exception_id=ex%2Fone',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('rejects a mismatched exception target instead of selecting its entry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { correctionTarget: { exceptionId: 'different', entryId: 'en-2' } },
      }),
    }));

    await expect(getCorrectionTarget('requested')).rejects.toMatchObject({
      code: 'INVALID_CORRECTION_TARGET',
    });
  });

  it('rejects an incomplete current-attendance payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          workDate: '2026-08-04',
          open: null,
          schedule: {},
          result: { status: 'expected' },
          requiredAttendanceAction: null,
        },
      }),
    }));

    await expect(getCurrentAttendance()).rejects.toMatchObject({
      code: 'INVALID_ATTENDANCE_STATE',
    });
  });

  it('posts the exception-linked correction contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          adjustmentId: 'adj-1',
          exceptionId: 'ex-1',
          decisionEventId: 'event-1',
          exceptionStatus: 'awaiting_supervisor',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await submitRequiredAttendanceCorrection({
      entryId: 'en-1',
      exceptionId: 'ex-1',
      adjustedClockOutAt: '2026-08-03T15:00:00.000Z',
      reason: 'Phone battery died before clock-out.',
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      entry_id: 'en-1',
      exception_id: 'ex-1',
      adjustment_kind: 'forgot_clock_out',
      adjusted_clock_in_at: null,
      adjusted_clock_out_at: '2026-08-03T15:00:00.000Z',
      adjusted_site_geofence_id: null,
      reason: 'Phone battery died before clock-out.',
    });
  });
});
