/**
 * SAST calendar arithmetic.
 *
 * These are the functions where a UTC answer looks right and is wrong by a day.
 * Each test below picks the value that makes the claim HARDEST - an instant in
 * the two-hour window where SAST and UTC disagree about the date, a month
 * boundary, a leap year - because a fixture in the middle of a month passes
 * whether or not the timezone handling exists at all.
 */
import { describe, expect, it } from 'vitest';
import {
  datesInMonth, endOfWorkDate, sastMonthStart, shiftMonth, toWorkDate,
} from '../sastDates';

/**
 * A `DATE` column as node-postgres hands it back when the server is on SAST:
 * midnight at a FIXED +02:00, whatever zone the test process happens to run in.
 *
 * The assertion below used the ambient zone and asserted that `toISOString()`
 * disagreed with the local date — true in Johannesburg, false under `TZ=UTC`,
 * and false in the other direction west of Greenwich. A test that passes only
 * where it was written is not evidence about the code.
 */
const sastDateColumn = (workDate: string): Date => new Date(`${workDate}T00:00:00+02:00`);

describe('toWorkDate', () => {
  it('reads a Date through its local parts, not through UTC', () => {
    // Constructed from local parts, exactly as a DATE column arrives: the
    // answer is those parts back, in any zone.
    expect(toWorkDate(new Date(2026, 7, 1, 0, 0, 0))).toBe('2026-08-01');
  });

  it('is why the UTC route cannot be used: SAST midnight is the day before', () => {
    // Fixed offset, so this holds identically under TZ=UTC and TZ=Pacific/Midway.
    expect(sastDateColumn('2026-08-01').toISOString().slice(0, 10)).toBe('2026-07-31');
  });

  it('pads single-digit months and days', () => {
    expect(toWorkDate(new Date(2026, 0, 5, 0, 0, 0))).toBe('2026-01-05');
  });

  it('trims a timestamp string to its date part', () => {
    expect(toWorkDate('2026-08-01T22:30:00.000Z')).toBe('2026-08-01');
    expect(toWorkDate('2026-08-01')).toBe('2026-08-01');
  });
});

describe('sastMonthStart', () => {
  it('puts a late-UTC instant in the SAST month that has already begun', () => {
    // 22:30 UTC on 31 July is 00:30 on 1 August in Johannesburg.
    expect(sastMonthStart('2026-07-31T22:30:00Z')).toBe('2026-08-01');
  });

  it('does not roll a same-day instant forward', () => {
    expect(sastMonthStart('2026-07-31T12:00:00Z')).toBe('2026-07-01');
  });

  it('handles a year boundary in the disagreeing window', () => {
    expect(sastMonthStart('2025-12-31T22:30:00Z')).toBe('2026-01-01');
  });
});

describe('shiftMonth', () => {
  it('crosses a year boundary in both directions', () => {
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01');
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
  });

  it('shifts by more than twelve months', () => {
    expect(shiftMonth('2026-08-01', -14)).toBe('2025-06-01');
  });

  it('is the identity at zero', () => {
    expect(shiftMonth('2026-08-01', 0)).toBe('2026-08-01');
  });

  it('refuses a value that is not a month start', () => {
    expect(() => shiftMonth('not-a-date', 1)).toThrow();
  });
});

describe('datesInMonth', () => {
  it('gives February 28 days in a common year', () => {
    const days = datesInMonth('2026-02-01');
    expect(days).toHaveLength(28);
    expect(days.at(-1)).toBe('2026-02-28');
  });

  it('gives February 29 days in a leap year', () => {
    const days = datesInMonth('2024-02-01');
    expect(days).toHaveLength(29);
    expect(days.at(-1)).toBe('2024-02-29');
  });

  it('does NOT give February 29 days in a century non-leap year', () => {
    // 1900 is divisible by 4 but not a leap year. A naive `year % 4` check
    // passes every other test above and fails only here.
    expect(datesInMonth('1900-02-01')).toHaveLength(28);
    expect(datesInMonth('2000-02-01')).toHaveLength(29);
  });

  it.each([
    ['2026-01-01', 31], ['2026-04-01', 30], ['2026-06-01', 30],
    ['2026-09-01', 30], ['2026-11-01', 30], ['2026-12-01', 31],
  ])('gives %s the right number of days', (month, expected) => {
    expect(datesInMonth(month)).toHaveLength(expected);
  });

  it('starts on the first and pads every day', () => {
    const days = datesInMonth('2026-08-01');
    expect(days[0]).toBe('2026-08-01');
    expect(days[8]).toBe('2026-08-09');
    expect(days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
  });

  it('refuses a value that is not a month start', () => {
    expect(() => datesInMonth('garbage')).toThrow();
  });
});

describe('endOfWorkDate', () => {
  it('is the last second of the day in SAST, not in UTC', () => {
    // 23:59:59 +02:00 is 21:59:59Z the same day.
    expect(endOfWorkDate('2026-08-01')).toBe('2026-08-01T21:59:59.000Z');
  });

  it('is stable, so a re-run evaluates the same instant', () => {
    expect(endOfWorkDate('2026-08-01')).toBe(endOfWorkDate('2026-08-01'));
  });
});
