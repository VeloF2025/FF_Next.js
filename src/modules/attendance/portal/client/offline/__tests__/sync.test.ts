/**
 * Unit tests for the pure sync engine + classifyApiError.
 *
 * These are the load-bearing bits of offline sync — a regression here
 * silently drops or double-submits field-staff hours. Cover the permanent
 * vs transient classification carefully.
 */

import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../api';
import type { PendingClockEvent } from '../db';
import {
  MAX_ATTEMPTS_BEFORE_DRAIN,
  classifyApiError,
  flushQueue,
  type SubmitClockEvent,
} from '../sync';

function event(id: string, action: 'in' | 'out' = 'in', attempts = 0): PendingClockEvent {
  return {
    id,
    action,
    lat: -26.2,
    lon: 28.0,
    accuracyM: 25,
    clientOccurredAt: '2026-04-20T06:00:00Z',
    selfieBase64: 'x',
    queuedAt: `2026-04-20T06:${id.padStart(2, '0')}:00Z`,
    attempts,
  };
}

describe('classifyApiError', () => {
  it('drains clock_skew — user cannot fix a stale queue timestamp', () => {
    const err = new ApiError(400, 'BAD_REQUEST', 'skew', { reason: 'clock_skew' });
    const r = classifyApiError(err, 'in');
    expect(r.drain).toBe(true);
    expect(r.errorMessage).toMatch(/phone time/i);
  });

  it('drains duplicate open_entry on clock-in', () => {
    const err = new ApiError(409, 'CONFLICT', 'open', { reason: 'open_entry' });
    expect(classifyApiError(err, 'in').drain).toBe(true);
  });

  it('KEEPS 409 on clock-out (unknown 4xx default) so we don\'t lose a shift', () => {
    const err = new ApiError(409, 'CONFLICT', 'open', { reason: 'open_entry' });
    expect(classifyApiError(err, 'out').drain).toBe(false);
  });

  it('KEEPS no_open_entry on clock-out — local state cannot prove idempotency', () => {
    // Scenario: user clocks out online, response lost, retry succeeds,
    // queue flush now sees 404 because the entry is closed. If we drained
    // here we could also be dropping a legitimate "no clock-in ever made
    // it". Keeping + letting the attempts cap handle true dead-ends avoids
    // silent shift loss.
    const err = new ApiError(404, 'NOT_FOUND', 'none', { reason: 'no_open_entry' });
    expect(classifyApiError(err, 'out').drain).toBe(false);
  });

  it('keeps 401 — queue should wait for re-auth, not self-destruct', () => {
    const err = new ApiError(401, 'UNAUTHORIZED', 'expired');
    const r = classifyApiError(err, 'in');
    expect(r.drain).toBe(false);
    expect(r.errorMessage).toMatch(/sign in/i);
  });

  it('keeps 403 consent_* — user must re-grant before sync progresses', () => {
    for (const reason of ['consent_missing', 'consent_revoked', 'consent_revoked_mid_shift']) {
      const err = new ApiError(403, 'FORBIDDEN', 'c', { reason });
      expect(classifyApiError(err, 'in').drain).toBe(false);
    }
  });

  it('keeps NETWORK_ERROR — retry on next online transition', () => {
    const err = new ApiError(0, 'NETWORK_ERROR', 'down');
    expect(classifyApiError(err, 'in').drain).toBe(false);
  });

  it('keeps 5xx — server had a bad minute, retry later', () => {
    const err = new ApiError(503, 'INTERNAL_ERROR', 'deploy');
    expect(classifyApiError(err, 'in').drain).toBe(false);
  });

  it('keeps 429 rate-limit transient (morning clock-in storm)', () => {
    const err = new ApiError(429, 'TOO_MANY', 'burst');
    expect(classifyApiError(err, 'in').drain).toBe(false);
  });

  it('keeps 408 timeout + 425 too early as transient', () => {
    expect(classifyApiError(new ApiError(408, 'TIMEOUT', 't'), 'in').drain).toBe(false);
    expect(classifyApiError(new ApiError(425, 'EARLY', 't'), 'in').drain).toBe(false);
  });

  it('keeps unknown 4xx by default — don\'t silently delete shifts on new reason codes', () => {
    // Regression guard: an earlier version drained 422 as "unknown 4xx".
    // That allowed any new server-side reason code (future
    // `selfie_too_small`, `site_out_of_bounds`, etc.) to silently delete a
    // shift. Now we keep; the attempts cap handles true dead-ends with a
    // persistent dropped-events row.
    const err = new ApiError(422, 'VALIDATION_ERROR', 'bad lat/lon');
    expect(classifyApiError(err, 'in').drain).toBe(false);
  });
});

describe('flushQueue', () => {
  function hooks() {
    return {
      onDrain: vi.fn().mockResolvedValue(undefined),
      onTransient: vi.fn().mockResolvedValue(undefined),
      onAbandon: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('drains everything the server accepts, reports counts', async () => {
    const events = [event('1'), event('2'), event('3')];
    const submit: SubmitClockEvent = vi.fn().mockResolvedValue({ drain: true });
    const h = hooks();
    const report = await flushQueue(events, submit, h);
    expect(report.attempted).toBe(3);
    expect(report.drained).toBe(3);
    expect(report.kept).toBe(0);
    expect(h.onDrain).toHaveBeenCalledTimes(3);
    expect(h.onTransient).not.toHaveBeenCalled();
    expect(h.onAbandon).not.toHaveBeenCalled();
  });

  it('stops flushing on the first transient failure (back-off)', async () => {
    const events = [event('1'), event('2'), event('3')];
    const submit: SubmitClockEvent = vi
      .fn()
      .mockResolvedValueOnce({ drain: true })
      .mockResolvedValueOnce({ drain: false, errorMessage: 'down' })
      .mockResolvedValue({ drain: true });
    const h = hooks();
    const report = await flushQueue(events, submit, h);
    expect(report.drained).toBe(1);
    expect(report.kept).toBe(1);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(h.onDrain).toHaveBeenCalledWith('1', expect.any(String));
    expect(h.onTransient).toHaveBeenCalledWith('2', 'down');
  });

  it('stops flushing on a thrown error (treats as transient)', async () => {
    const events = [event('1'), event('2')];
    const submit: SubmitClockEvent = vi.fn().mockRejectedValueOnce(new Error('boom'));
    const h = hooks();
    const report = await flushQueue(events, submit, h);
    expect(report.drained).toBe(0);
    expect(report.kept).toBe(1);
    expect(report.failures[0]).toEqual({ id: '1', message: 'boom' });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('records a drain-with-failure message (permanent drain path)', async () => {
    const events = [event('1')];
    const submit: SubmitClockEvent = vi
      .fn()
      .mockResolvedValue({ drain: true, errorMessage: 'Dropped: clock_skew' });
    const h = hooks();
    const report = await flushQueue(events, submit, h);
    expect(report.drained).toBe(1);
    expect(report.failures).toEqual([{ id: '1', message: 'Dropped: clock_skew' }]);
    expect(h.onDrain).toHaveBeenCalledWith('1', 'Dropped: clock_skew');
  });

  it('abandons an event that has exceeded MAX_ATTEMPTS — never calls submit', async () => {
    const events = [event('1', 'in', MAX_ATTEMPTS_BEFORE_DRAIN)];
    const submit = vi.fn();
    const h = hooks();
    const report = await flushQueue(events, submit as unknown as SubmitClockEvent, h);
    expect(submit).not.toHaveBeenCalled();
    expect(h.onAbandon).toHaveBeenCalledWith('1', expect.stringMatching(/Abandoned/));
    expect(report.drained).toBe(1);
  });

  it('abandons one event then moves on to the next (doesn\'t short-circuit on abandon)', async () => {
    const events = [
      event('1', 'in', MAX_ATTEMPTS_BEFORE_DRAIN + 1),
      event('2', 'in', 0),
    ];
    const submit: SubmitClockEvent = vi.fn().mockResolvedValue({ drain: true });
    const h = hooks();
    const report = await flushQueue(events, submit, h);
    expect(report.attempted).toBe(2);
    expect(report.drained).toBe(2);
    expect(h.onAbandon).toHaveBeenCalledTimes(1);
    expect(h.onDrain).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('handles an empty queue cleanly', async () => {
    const submit = vi.fn();
    const report = await flushQueue([], submit as unknown as SubmitClockEvent, hooks());
    expect(report).toEqual({ attempted: 0, drained: 0, kept: 0, failures: [] });
    expect(submit).not.toHaveBeenCalled();
  });
});
