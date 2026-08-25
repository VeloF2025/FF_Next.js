/**
 * The after-hours window, which wraps midnight.
 *
 * Every assertion here is TZ-hermetic: `isAfterHours` reads the instant through
 * `Intl` in the rule's own zone, so these must pass identically under
 * TZ=Africa/Johannesburg and TZ=UTC. CI runs both.
 *
 * The holiday fixture is parsed out of migration 310 rather than hand-written,
 * because a hand-written list is a copy of the rule and a test that holds a copy
 * tests the copy. 2026-04-27 is Freedom Day in the real seed.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAfterHours } from '../afterHours';
import type { VehicleOperationalRule } from '../types';

/** Observed holiday dates as migration 310 actually seeds them. */
function seededHolidays(): Set<string> {
  const sql = readFileSync(resolve(process.cwd(), 'scripts/migrations/sql/310_attendance_core.sql'), 'utf8');
  const block = sql.slice(sql.indexOf('INSERT INTO public_holidays'));
  const dates = block.match(/\('(\d{4}-\d{2}-\d{2})'/g)?.map((match) => match.slice(2, 12)) ?? [];
  if (dates.length < 12) throw new Error(`Expected the seeded holiday calendar, found ${dates.length} dates`);
  return new Set(dates);
}

const HOLIDAYS = seededHolidays();

const rule: VehicleOperationalRule = {
  id: 'rule-1', version: 1, timezone: 'Africa/Johannesburg',
  effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: null,
  afterHoursStartTime: '18:00:00', afterHoursEndTime: '06:00:00',
  weekendsAreAfterHours: true, publicHolidaysAreAfterHours: true,
  theftDisplacementMeters: 500, theftMinPositions: 2,
  harshLinearG: 0.35, harshLateralG: 0.35, harshMinSpeedKph: 20, speedOverLimitKph: 15,
  unauthorizedStopMinutes: 45, lostContactMinutes: 30, idleAlertMinutes: 20,
  knownSiteRadiusMeters: 500, changeReason: null, createdBy: null,
  createdAt: '2026-08-01T00:00:00.000Z',
};

/** `YYYY-MM-DDTHH:MM` in SAST as a UTC instant. SAST has no DST. */
const sast = (local: string): string => `${local}:00+02:00`;

describe('the after-hours window boundaries', () => {
  // 2026-08-26 is a Wednesday, so nothing here can pass by way of the weekend rule.
  it.each([
    ['17:59', false],
    ['18:00', true],
    ['23:59', true],
    ['05:59', true],
    ['06:00', false],
    ['12:00', false],
  ])('a Wednesday at %s SAST is after-hours: %s', (time, expected) => {
    expect(isAfterHours(sast(`2026-08-26T${time}`), rule, HOLIDAYS)).toBe(expected);
  });

  it('spans midnight as ONE window, not two — 23:00 and 01:00 are the same night', () => {
    // The naive `start <= t && t < end` comparison is false for BOTH of these,
    // which is how a wrapping window silently disables a detector.
    expect(isAfterHours(sast('2026-08-26T23:00'), rule, HOLIDAYS)).toBe(true);
    expect(isAfterHours(sast('2026-08-27T01:00'), rule, HOLIDAYS)).toBe(true);
  });

  it('honours a non-wrapping window too, so the comparison is not hard-coded to wrap', () => {
    const daytime = { ...rule, afterHoursStartTime: '10:00:00', afterHoursEndTime: '14:00:00' };
    expect(isAfterHours(sast('2026-08-26T09:59'), daytime, HOLIDAYS)).toBe(false);
    expect(isAfterHours(sast('2026-08-26T10:00'), daytime, HOLIDAYS)).toBe(true);
    expect(isAfterHours(sast('2026-08-26T13:59'), daytime, HOLIDAYS)).toBe(true);
    expect(isAfterHours(sast('2026-08-26T14:00'), daytime, HOLIDAYS)).toBe(false);
  });
});

describe('the calendar rules', () => {
  it('treats a Saturday mid-morning as after-hours', () => {
    // 2026-08-29 is a Saturday. 10:00 is outside the clock window entirely.
    expect(isAfterHours(sast('2026-08-29T10:00'), rule, HOLIDAYS)).toBe(true);
    expect(isAfterHours(sast('2026-08-30T10:00'), rule, HOLIDAYS)).toBe(true);
  });

  it('does not treat a weekend as after-hours when the rule says not to', () => {
    const weekdaysOnly = { ...rule, weekendsAreAfterHours: false };
    expect(isAfterHours(sast('2026-08-29T10:00'), weekdaysOnly, HOLIDAYS)).toBe(false);
  });

  it('treats Freedom Day 2026-04-27 as after-hours all day', () => {
    expect(HOLIDAYS.has('2026-04-27')).toBe(true);
    expect(isAfterHours(sast('2026-04-27T10:00'), rule, HOLIDAYS)).toBe(true);
    // The day after is an ordinary Tuesday.
    expect(isAfterHours(sast('2026-04-28T10:00'), rule, HOLIDAYS)).toBe(false);
  });

  it('does not consult the holiday calendar when the rule says not to', () => {
    const noHolidays = { ...rule, publicHolidaysAreAfterHours: false };
    expect(isAfterHours(sast('2026-04-27T10:00'), noHolidays, HOLIDAYS)).toBe(false);
  });

  it('reads the holiday date in SAST, not UTC', () => {
    // 2026-04-26T23:30Z is already 01:30 on Freedom Day in Johannesburg. A UTC
    // read would call it the 26th and miss the holiday — though the clock window
    // still covers it, so the date is asserted through a daytime instant too.
    expect(isAfterHours('2026-04-26T23:30:00.000Z', rule, HOLIDAYS)).toBe(true);
    // 2026-04-27T21:30Z is already 23:30 on the 27th... but 2026-04-27T06:30Z is
    // 08:30 SAST on Freedom Day, outside every clock window.
    expect(isAfterHours('2026-04-27T06:30:00.000Z', rule, HOLIDAYS)).toBe(true);
    // And 2026-04-28T06:30Z is 08:30 SAST the day after: ordinary hours.
    expect(isAfterHours('2026-04-28T06:30:00.000Z', rule, HOLIDAYS)).toBe(false);
  });

  it('reads the weekday in SAST, not UTC', () => {
    // 2026-08-28T22:30Z is Friday in UTC and Saturday 00:30 in Johannesburg.
    const weekdayWindowOff = { ...rule, afterHoursStartTime: '00:00:00', afterHoursEndTime: '00:01:00' };
    expect(isAfterHours('2026-08-28T22:30:00.000Z', { ...weekdayWindowOff, weekendsAreAfterHours: false }, HOLIDAYS)).toBe(false);
    expect(isAfterHours('2026-08-28T22:30:00.000Z', weekdayWindowOff, HOLIDAYS)).toBe(true);
  });
});

describe('degenerate input', () => {
  it('treats equal window boundaries as a window that never closes', () => {
    const always = { ...rule, afterHoursStartTime: '00:00:00', afterHoursEndTime: '00:00:00', weekendsAreAfterHours: false, publicHolidaysAreAfterHours: false };
    expect(isAfterHours(sast('2026-08-26T12:00'), always, HOLIDAYS)).toBe(true);
  });

  it('refuses an instant it cannot parse rather than guessing', () => {
    expect(() => isAfterHours('not-an-instant', rule, HOLIDAYS)).toThrow(/Not an instant/);
  });
});
