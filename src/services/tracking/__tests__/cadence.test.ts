import { describe, it, expect } from 'vitest';
import { RAMP_STEPS, demote, isTickDue } from '../cadence';

describe('isTickDue', () => {
  const now = new Date('2026-08-12T10:00:00Z');

  it('runs when the account has never run', () => {
    expect(isTickDue(null, 120, now)).toBe(true);
  });

  it('skips when the interval has not elapsed', () => {
    expect(isTickDue(new Date(now.getTime() - 60 * 60_000), 120, now)).toBe(false);
  });

  it('runs once the interval has elapsed', () => {
    expect(isTickDue(new Date(now.getTime() - 120 * 60_000), 120, now)).toBe(true);
  });

  it('runs slightly early rather than skipping a whole cycle', () => {
    // Cron fires on the minute and last_run_at is stamped seconds later, so an
    // exact >= comparison drops every other tick. 30s of grace absorbs that.
    expect(isTickDue(new Date(now.getTime() - 119.7 * 60_000), 120, now)).toBe(true);
  });
});

describe('demotion', () => {
  it('steps back to the next slower interval', () => {
    expect(demote(10)).toBe(30);
    expect(demote(30)).toBe(120);
  });

  it('stops at the slowest step', () => {
    expect(demote(120)).toBe(120);
  });

  it('snaps an unrecognised interval to the slowest step', () => {
    // A hand-edited row must fail safe — slower, never faster.
    expect(demote(7)).toBe(120);
  });

  it('never proposes a step outside the ramp', () => {
    for (const s of RAMP_STEPS) expect(RAMP_STEPS).toContain(demote(s));
  });
});
