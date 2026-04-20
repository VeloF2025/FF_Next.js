/**
 * Tests for submitClockEventWithOfflineFallback — the single entry point the
 * clock page uses. Exercises the routing logic for:
 *   - offline → enqueue
 *   - online + success → submitted_in/out
 *   - online + NETWORK_ERROR → enqueue
 *   - online + consent → consent_required
 *   - online + other → error
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  enqueueClockEvent: vi.fn(),
  ApiErrorClass: null as unknown as typeof import('../../api').ApiError,
}));

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  mocks.ApiErrorClass = actual.ApiError;
  return {
    ...actual,
    clockIn: mocks.clockIn,
    clockOut: mocks.clockOut,
  };
});

vi.mock('../db', async () => {
  const actual = await vi.importActual<typeof import('../db')>('../db');
  return {
    ...actual,
    enqueueClockEvent: mocks.enqueueClockEvent,
  };
});

import { submitClockEventWithOfflineFallback } from '../submitClockEvent';
import { QueueFullError } from '../db';

const payload = {
  lat: -26.2,
  lon: 28.0,
  accuracyM: 25,
  clientOccurredAt: '2026-04-20T06:00:00Z',
  selfieBase64: 'abc',
  deviceFingerprint: 'dev-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enqueueClockEvent.mockResolvedValue(undefined);
});

describe('submitClockEventWithOfflineFallback', () => {
  it('enqueues when offline (no network call)', async () => {
    const result = await submitClockEventWithOfflineFallback('in', payload, { online: false });
    expect(result).toEqual({ kind: 'queued' });
    expect(mocks.enqueueClockEvent).toHaveBeenCalledTimes(1);
    expect(mocks.clockIn).not.toHaveBeenCalled();
  });

  it('submits online clock-in and returns the server response', async () => {
    mocks.clockIn.mockResolvedValue({
      entryId: 'e1',
      insideSite: true,
      siteName: 'Lawley POP 1',
      workDate: '2026-04-20',
      clockInAt: '2026-04-20T06:00:00Z',
      siteId: 's1',
      vehicleAssignmentId: null,
      selfieUrl: '/storage/x.jpg',
    });
    const result = await submitClockEventWithOfflineFallback('in', payload, { online: true });
    expect(result.kind).toBe('submitted_in');
    if (result.kind === 'submitted_in') {
      expect(result.response.siteName).toBe('Lawley POP 1');
    }
    expect(mocks.enqueueClockEvent).not.toHaveBeenCalled();
  });

  it('submits online clock-out and returns the server response', async () => {
    mocks.clockOut.mockResolvedValue({
      entryId: 'e1',
      workDate: '2026-04-20',
      clockInAt: '2026-04-20T06:00:00Z',
      clockOutAt: '2026-04-20T14:00:00Z',
      durationMs: 8 * 3_600_000,
      selfieUrl: '/storage/out.jpg',
    });
    const result = await submitClockEventWithOfflineFallback('out', payload, { online: true });
    expect(result.kind).toBe('submitted_out');
    if (result.kind === 'submitted_out') {
      expect(result.response.durationMs).toBe(8 * 3_600_000);
    }
  });

  it('falls through to enqueue on NETWORK_ERROR during submit', async () => {
    mocks.clockIn.mockRejectedValue(
      new mocks.ApiErrorClass(0, 'NETWORK_ERROR', 'Unreachable')
    );
    const result = await submitClockEventWithOfflineFallback('in', payload, { online: true });
    expect(result).toEqual({ kind: 'queued' });
    expect(mocks.enqueueClockEvent).toHaveBeenCalledTimes(1);
  });

  it('surfaces consent_required on 403 consent_missing', async () => {
    mocks.clockIn.mockRejectedValue(
      new mocks.ApiErrorClass(403, 'FORBIDDEN', 'Consent required', { reason: 'consent_missing' })
    );
    const result = await submitClockEventWithOfflineFallback('in', payload, { online: true });
    expect(result).toEqual({ kind: 'consent_required' });
    expect(mocks.enqueueClockEvent).not.toHaveBeenCalled();
  });

  it('surfaces error for permanent failures like clock_skew', async () => {
    mocks.clockIn.mockRejectedValue(
      new mocks.ApiErrorClass(400, 'BAD_REQUEST', 'Clock skew', { reason: 'clock_skew' })
    );
    const result = await submitClockEventWithOfflineFallback('in', payload, { online: true });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.message).toMatch(/time/i);
    expect(mocks.enqueueClockEvent).not.toHaveBeenCalled();
  });

  it('reports not_saved (not generic error) when enqueue fails generically', async () => {
    mocks.enqueueClockEvent.mockRejectedValue(new Error('quota exceeded'));
    const result = await submitClockEventWithOfflineFallback('in', payload, { online: false });
    // not_saved — emphatic UI so a tired user doesn't mistake for success.
    expect(result.kind).toBe('not_saved');
    if (result.kind === 'not_saved') {
      expect(result.message).toMatch(/NOT saved/);
      expect(result.message).toMatch(/supervisor/i);
    }
  });

  it('reports not_saved with the queue-full message when IDB rejects QueueFullError', async () => {
    mocks.enqueueClockEvent.mockRejectedValue(new QueueFullError(50));
    const result = await submitClockEventWithOfflineFallback('in', payload, { online: false });
    expect(result.kind).toBe('not_saved');
    if (result.kind === 'not_saved') {
      expect(result.message).toMatch(/queue is full/i);
    }
  });
});
