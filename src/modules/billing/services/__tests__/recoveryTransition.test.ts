import { describe, it, expect } from 'vitest';
import { decideRecovery } from '../recoveryTransition';

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

describe('decideRecovery — terminal / re-deduction handling', () => {
  it('not_returned is terminal → noop regardless of deduction', () => {
    expect(decideRecovery({ existing: { status: 'not_returned', detectedWeekEnding: EARLIER }, stillDeductedThisWeek: true, currentWeekEnding: WEEK }))
      .toBe('noop');
    expect(decideRecovery({ existing: { status: 'not_returned', detectedWeekEnding: EARLIER }, stillDeductedThisWeek: false, currentWeekEnding: WEEK }))
      .toBe('noop');
  });

  it('recovered + FT dropped it (still honoured) → noop', () => {
    expect(decideRecovery({ existing: { status: 'recovered', detectedWeekEnding: EARLIER }, stillDeductedThisWeek: false, currentWeekEnding: WEEK }))
      .toBe('noop');
  });

  it('recovered + FT RE-DEDUCTED it → mark_not_returned (re-billed a conceded DR)', () => {
    expect(decideRecovery({ existing: { status: 'recovered', detectedWeekEnding: EARLIER }, stillDeductedThisWeek: true, currentWeekEnding: WEEK }))
      .toBe('mark_not_returned');
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
