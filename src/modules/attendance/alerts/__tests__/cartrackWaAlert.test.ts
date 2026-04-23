/**
 * Unit tests for the Cartrack reconcile → WA alert module.
 *
 * shouldAlert + buildAlertMessage are pure; sendCartrackReconcileAlert
 * has the WA sender injected so the test uses a local stub.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CartrackReconcileReport } from '@/services/attendance/cartrackReconcile';
import {
  DEFAULT_MISMATCH_THRESHOLD,
  buildAlertMessage,
  sendCartrackReconcileAlert,
  shouldAlert,
} from '../cartrackWaAlert';

function baseReport(
  overrides: Partial<CartrackReconcileReport> = {}
): CartrackReconcileReport {
  return {
    scannedFrom: '2026-04-22',
    scannedTo: '2026-04-22',
    entriesConsidered: 50,
    rowsMatch: 48,
    rowsMismatch: 0,
    rowsNoData: 1,
    rowsVehicleNotMapped: 1,
    rowsDeviceGpsOff: 0,
    rowsSkipped: 0,
    mismatchExceptionsRaised: 0,
    perEntryErrors: [],
    startedAt: '2026-04-23T03:00:00Z',
    finishedAt: '2026-04-23T03:00:05Z',
    ...overrides,
  };
}

describe('shouldAlert', () => {
  it('returns no reasons for a clean run below every threshold', () => {
    const reasons = shouldAlert(baseReport(), {
      mismatchThreshold: DEFAULT_MISMATCH_THRESHOLD,
    });
    expect(reasons).toEqual([]);
  });

  it('fires on rowsMismatch >= threshold', () => {
    const reasons = shouldAlert(baseReport({ rowsMismatch: 5 }), {
      mismatchThreshold: 5,
    });
    expect(reasons.length).toBe(1);
    expect(reasons[0]).toMatch(/mismatches=5.*threshold=5/);
  });

  it('does NOT fire when rowsMismatch is strictly below threshold', () => {
    const reasons = shouldAlert(baseReport({ rowsMismatch: 4 }), {
      mismatchThreshold: 5,
    });
    expect(reasons).toEqual([]);
  });

  it('fires on any perEntryErrors', () => {
    const reasons = shouldAlert(
      baseReport({ perEntryErrors: [{ entryId: 'e-1', error: 'HTTP 500' }] }),
      { mismatchThreshold: 100 }
    );
    expect(reasons.some((r) => /perEntryErrors=1/.test(r))).toBe(true);
  });

  it('fires on circuitBrokenAfter being set', () => {
    const reasons = shouldAlert(baseReport({ circuitBrokenAfter: 20 }), {
      mismatchThreshold: 100,
    });
    expect(reasons.some((r) => /circuitBrokenAfter=20/.test(r))).toBe(true);
  });

  it('can trip all three triggers at once (reasons accumulate)', () => {
    const reasons = shouldAlert(
      baseReport({
        rowsMismatch: 10,
        perEntryErrors: [
          { entryId: 'e-1', error: 'x' },
          { entryId: 'e-2', error: 'y' },
        ],
        circuitBrokenAfter: 20,
      }),
      { mismatchThreshold: 5 }
    );
    expect(reasons).toHaveLength(3);
  });

  it('mismatchThreshold=0 alerts on any mismatch (very-sensitive mode)', () => {
    const reasons = shouldAlert(baseReport({ rowsMismatch: 1 }), {
      mismatchThreshold: 0,
    });
    expect(reasons).toHaveLength(1);
  });
});

describe('buildAlertMessage', () => {
  it('includes the scan window, bucket summary, and trigger list', () => {
    const report = baseReport({ rowsMismatch: 5, mismatchExceptionsRaised: 5 });
    const msg = buildAlertMessage(report, ['mismatches=5 (threshold=5)']);
    expect(msg).toMatch(/Cartrack reconcile/);
    expect(msg).toMatch(/Scanned:\s*2026-04-22\.\.2026-04-22/);
    expect(msg).toMatch(/Entries:\s*50/);
    expect(msg).toMatch(/Match:\s*48\s*\|\s*Mismatch:\s*5/);
    expect(msg).toMatch(/Exceptions raised:\s*5/);
    expect(msg).toMatch(/Trigger:\s*mismatches=5/);
  });

  it('surfaces device_gps_off only when > 0 (keeps alert compact)', () => {
    const quiet = buildAlertMessage(baseReport(), ['foo']);
    expect(quiet).not.toMatch(/Device-GPS-off/);

    const noisy = buildAlertMessage(
      baseReport({ rowsDeviceGpsOff: 3 }),
      ['foo']
    );
    expect(noisy).toMatch(/Device-GPS-off:\s*3/);
  });

  it('surfaces circuit-broke line only when circuitBrokenAfter is set', () => {
    const quiet = buildAlertMessage(baseReport(), ['x']);
    expect(quiet).not.toMatch(/Circuit broke/);

    const noisy = buildAlertMessage(
      baseReport({ circuitBrokenAfter: 20 }),
      ['x']
    );
    expect(noisy).toMatch(/Circuit broke after 20 entries/);
  });
});

describe('sendCartrackReconcileAlert', () => {
  const logger = { info: vi.fn(), error: vi.fn() };
  beforeEach(() => {
    logger.info.mockReset();
    logger.error.mockReset();
  });

  it('skips the send when no thresholds trip (logs and exits)', async () => {
    const send = vi.fn();
    const result = await sendCartrackReconcileAlert({
      report: baseReport(),
      groupJid: 'test@g.us',
      mismatchThreshold: 5,
      send,
      logger,
    });
    expect(result.alerted).toBe(false);
    expect(result.reasons).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('no WA alert')
    );
  });

  it('sends when thresholds trip and reports alerted=true', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await sendCartrackReconcileAlert({
      report: baseReport({ rowsMismatch: 10 }),
      groupJid: 'test@g.us',
      mismatchThreshold: 5,
      send,
      logger,
    });
    expect(result.alerted).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    const [jid, msg] = send.mock.calls[0]!;
    expect(jid).toBe('test@g.us');
    expect(msg).toMatch(/Cartrack reconcile/);
  });

  it('swallows send failures (best-effort, non-fatal to the cron)', async () => {
    const send = vi.fn().mockRejectedValue(new Error('WA bridge down'));
    const result = await sendCartrackReconcileAlert({
      report: baseReport({ rowsMismatch: 10 }),
      groupJid: 'test@g.us',
      mismatchThreshold: 5,
      send,
      logger,
    });
    expect(result.alerted).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('WA alert send failed')
    );
  });
});

