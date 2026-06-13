import { describe, it, expect } from 'vitest';
import { decideRecovery, type RecoveryStatus } from '../recoveryTransition';

const WEEK = '2026-06-07';
const EARLIER = '2026-05-31';
const LATER = '2026-06-14';

describe('decideRecovery — first sighting (no existing row)', () => {
  it('asserts a pending recovery when FT is still deducting the DR', () => {
    expect(decideRecovery({ existing: null, stillDeductedThisWeek: true, currentWeekEnding: WEEK }))
      .toBe('insert_pending');
  });

  it('records an immediate recovery when FT already dropped the DR', () => {
    expect(decideRecovery({ existing: null, stillDeductedThisWeek: false, currentWeekEnding: WEEK }))
      .toBe('insert_recovered');
  });
});

describe('decideRecovery — terminal existing rows are never reopened', () => {
  it.each<RecoveryStatus>(['recovered', 'not_returned'])('status %s → noop regardless of deduction', (status) => {
    expect(decideRecovery({ existing: { status, detectedWeekEnding: EARLIER }, stillDeductedThisWeek: true, currentWeekEnding: WEEK }))
      .toBe('noop');
    expect(decideRecovery({ existing: { status, detectedWeekEnding: EARLIER }, stillDeductedThisWeek: false, currentWeekEnding: WEEK }))
      .toBe('noop');
  });
});

describe('decideRecovery — pending rows get one cycle of grace', () => {
  it('does not judge a row detected in the SAME bundle week', () => {
    expect(decideRecovery({ existing: { status: 'pending', detectedWeekEnding: WEEK }, stillDeductedThisWeek: true, currentWeekEnding: WEEK }))
      .toBe('noop');
  });

  it('does not judge a row detected in a LATER week (clock skew safety)', () => {
    expect(decideRecovery({ existing: { status: 'pending', detectedWeekEnding: LATER }, stillDeductedThisWeek: true, currentWeekEnding: WEEK }))
      .toBe('noop');
  });
});

describe('decideRecovery — pending rows judged on the next bundle', () => {
  it('still deducted a cycle later → not_returned (dispute candidate)', () => {
    expect(decideRecovery({ existing: { status: 'pending', detectedWeekEnding: EARLIER }, stillDeductedThisWeek: true, currentWeekEnding: WEEK }))
      .toBe('mark_not_returned');
  });

  it('FT dropped it → recovered', () => {
    expect(decideRecovery({ existing: { status: 'pending', detectedWeekEnding: EARLIER }, stillDeductedThisWeek: false, currentWeekEnding: WEEK }))
      .toBe('mark_recovered');
  });
});
