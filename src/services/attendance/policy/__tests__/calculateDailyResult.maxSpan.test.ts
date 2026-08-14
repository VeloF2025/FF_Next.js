/**
 * Regression cover for #2479 — cross-midnight shifts crashing reconciliation.
 *
 * A worker who forgot to clock out and clocked out the next morning produced a
 * span over 24h. Nothing bounded it, so the projected columns overflowed their
 * CHECK constraints, the INSERT was rejected, and the day was dropped from
 * `attendance_daily_summaries` entirely — invisible to Pulse and to payroll,
 * while still showing hours in /field.
 *
 * These tests assert against the real constraint bounds rather than against the
 * guard's own threshold, so they fail if either the guard or the schedule moves
 * far enough to let a column overflow again.
 */

import { describe, expect, it } from 'vitest';

import { VELOCITY_FIXED_POLICY } from '../defaultPolicy';
import { calculateDailyResult } from '../calculateDailyResult';
import type { CalculatedDailyResult } from '../types';

const pair = (workDate: string, clockInAt: string, clockOutAt: string) => ({
  workDate,
  clockInAt: new Date(clockInAt),
  clockOutAt: new Date(clockOutAt),
  clockOutSource: 'device' as const,
});

const run = (
  evidence: ReturnType<typeof pair>,
  isPublicHoliday = false,
): CalculatedDailyResult =>
  calculateDailyResult({ policy: VELOCITY_FIXED_POLICY, evidence, isPublicHoliday });

/**
 * The CHECK constraints on `attendance_daily_summaries` that a projected day
 * must satisfy. Kept as literals so this test states the database contract
 * independently of the calculator — if they diverge, that is the bug.
 */
function expectWithinDatabaseConstraints(result: CalculatedDailyResult): void {
  expect(result.recordedElapsedHours ?? 0).toBeLessThanOrEqual(24);
  expect(result.proposedSundayHours).toBeLessThanOrEqual(24);
  expect(result.proposedHolidayHours).toBeLessThanOrEqual(24);
  expect(result.proposedOvertimeHours).toBeLessThanOrEqual(15);
  expect((result.proposedRegularHours ?? 0) + result.proposedOvertimeHours)
    .toBeLessThanOrEqual(24);
}

describe('calculateDailyResult — maximum span guard (#2479)', () => {
  // The two entries that failed reconciliation every night from 2026-08-12.
  // Timestamps are the production values, in UTC as stored.
  it.each([
    {
      who: 'Aron Kotlolo',
      evidence: pair('2026-08-11', '2026-08-11T04:58:22Z', '2026-08-12T05:48:30Z'),
      spanHours: 24.8,
    },
    {
      who: 'Patrick Sithole',
      evidence: pair('2026-08-11', '2026-08-11T05:52:51Z', '2026-08-12T07:23:00Z'),
      spanHours: 25.5,
    },
  ])('parks $who\'s $spanHours h cross-midnight span for a supervisor', ({ evidence }) => {
    const result = run(evidence);

    // Asserted first because this is the production symptom: the INSERT was
    // rejected by the CHECK constraints and the day never reached the table.
    expectWithinDatabaseConstraints(result);
    expect(result.status).toBe('awaiting_supervisor');
    expect(result.exceptionKinds).toEqual(['evidence_unreliable']);
    // Nothing is proposed: the span is not evidence of hours worked, and a
    // clamped figure would put a number nobody measured in front of a reviewer.
    expect(result.recordedElapsedHours).toBeNull();
    expect(result.proposedRegularHours).toBeNull();
    expect(result.proposedOvertimeHours).toBe(0);
  });

  it('rejects an over-long span on a public holiday, which projects holiday hours from the span', () => {
    const result = run(pair('2026-08-11', '2026-08-11T04:58:22Z', '2026-08-12T05:48:30Z'), true);

    // Without the guard this branch sets proposedHolidayHours from the span
    // (24.8) and breaches the <= 24 constraint, so it needs cover of its own.
    expectWithinDatabaseConstraints(result);
    expect(result.exceptionKinds).toEqual(['evidence_unreliable']);
    expect(result.proposedHolidayHours).toBe(0);
  });

  it('rejects an over-long span on a Sunday, which projects Sunday hours from the span', () => {
    // 2026-08-09 is a Sunday.
    const result = run(pair('2026-08-09', '2026-08-09T04:00:00Z', '2026-08-10T05:00:00Z'));

    expectWithinDatabaseConstraints(result);
    expect(result.exceptionKinds).toEqual(['evidence_unreliable']);
    expect(result.proposedSundayHours).toBe(0);
  });

  it('still projects a span of exactly 24 hours — the guard is not off by one', () => {
    // 00:00 SAST to 00:00 SAST the next day: the longest span that fits, and
    // simultaneously the worst case for overtime (8h before start + 7h after
    // end = exactly the 15h ceiling).
    const result = run(pair('2026-08-11', '2026-08-10T22:00:00Z', '2026-08-11T22:00:00Z'));

    expect(result.exceptionKinds).not.toContain('evidence_unreliable');
    expect(result.recordedElapsedHours).toBe(24);
    expect(result.proposedOvertimeHours).toBe(15);
    expectWithinDatabaseConstraints(result);
  });

  it('rejects a span one minute over 24 hours', () => {
    const result = run(pair('2026-08-11', '2026-08-10T22:00:00Z', '2026-08-11T22:01:00Z'));

    expect(result.exceptionKinds).toEqual(['evidence_unreliable']);
    expect(result.recordedElapsedHours).toBeNull();
  });

  it('leaves an ordinary cross-midnight night shift alone', () => {
    // 18:00 to 04:00 SAST — genuinely spans midnight, well inside the bound,
    // and must keep projecting overtime rather than being swept up by the guard.
    const result = run(pair('2026-08-11', '2026-08-11T16:00:00Z', '2026-08-12T02:00:00Z'));

    expect(result.exceptionKinds).not.toContain('evidence_unreliable');
    expect(result.recordedElapsedHours).toBe(10);
    expect(result.proposedOvertimeHours).toBeGreaterThan(0);
    expectWithinDatabaseConstraints(result);
  });
});
