/**
 * Unit tests for the pure BCEA overtime calculator.
 *
 * Calendar anchors used throughout:
 *   - 2026-04-20 is a Monday  — weekday baseline
 *   - 2026-04-19 is a Sunday  — Sunday multiplier path
 *   - 2026-04-27 (Freedom Day) is a Monday public holiday (migration 310)
 *
 * We only import indirectly via the calculator; db-pool is mocked at module
 * load to avoid the pg.Pool initialising against a real DATABASE_URL.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: vi.fn() }));

import {
  calculateDailySummary,
  type AttendanceEntryInput,
  type CalculateDailySummaryArgs,
  type OvertimeRuleInput,
} from '../overtimeCalculator';

const BCEA_RULE: OvertimeRuleInput = {
  id: 'rule-bcea-default',
  dailyOrdinaryHrs: 9,
  weeklyOrdinaryHrs: 45,
  weeklyOtCapHrs: 10,
  otMultiplier: 1.5,
  sundayMultiplierDefault: 2.0,
  sundayOrdinaryMultiplier: 1.5,
  holidayMultiplier: 2.0,
  nightShiftAllowance: 0.1,
  nightStart: '18:00',
  nightEnd: '06:00',
};

function sast(day: string, hm: string): Date {
  return new Date(`${day}T${hm}:00+02:00`);
}

function entry(day: string, inHm: string, outHm: string | null): AttendanceEntryInput {
  return {
    workDate: day,
    clockInAt: sast(day, inHm),
    clockOutAt: outHm === null ? null : sast(day, outHm),
  };
}

function call(overrides: Partial<CalculateDailySummaryArgs> = {}) {
  return calculateDailySummary({
    entry: entry('2026-04-20', '08:00', '16:00'),
    rule: BCEA_RULE,
    publicHolidays: new Set(),
    staffBceaApplicable: true,
    ...overrides,
  });
}

describe('calculateDailySummary — BCEA default path', () => {
  it('normal 8h weekday — all regular, no OT', () => {
    const s = call();
    expect(s).toMatchObject({
      regularHrs: 8,
      overtimeHrs: 0,
      sundayHrs: 0,
      holidayHrs: 0,
      nightHrs: 0,
      computationMode: 'bcea_default',
      incomplete: false,
      weeklyOvertimeOverCap: false,
    });
  });

  it('10h weekday — 9h regular + 1h OT', () => {
    const s = call({ entry: entry('2026-04-20', '07:00', '17:00') });
    expect(s.regularHrs).toBe(9);
    expect(s.overtimeHrs).toBe(1);
    expect(s.sundayHrs).toBe(0);
    expect(s.holidayHrs).toBe(0);
  });

  it('exactly 9h weekday (boundary) — all regular, no OT', () => {
    const s = call({ entry: entry('2026-04-20', '08:00', '17:00') });
    expect(s.regularHrs).toBe(9);
    expect(s.overtimeHrs).toBe(0);
  });

  it('Sunday non-ordinary worker, 11h — regular/OT still split; sundayHrs dual-counts full 11h', () => {
    // Regression guard against a bug that aliases sundayHrs = regularHrs.
    // Using an 11h shift so total > dailyOrdinaryHrs; makes the OT assertion
    // non-trivial (unlike a 9h shift where OT would be 0 either way).
    const s = call({
      entry: entry('2026-04-19', '06:00', '17:00'),
    });
    expect(s.regularHrs).toBe(9);
    expect(s.overtimeHrs).toBe(2);
    expect(s.sundayHrs).toBe(11);
    expect(s.holidayHrs).toBe(0);
  });

  it('public holiday (weekday), 11h — holidayHrs dual-counts full 11h, regular/OT split', () => {
    const s = call({
      entry: entry('2026-04-27', '06:00', '17:00'),
      publicHolidays: new Set(['2026-04-27']),
    });
    expect(s.holidayHrs).toBe(11);
    expect(s.regularHrs).toBe(9);
    expect(s.overtimeHrs).toBe(2);
    expect(s.sundayHrs).toBe(0);
  });

  it('public holiday on Sunday — both sundayHrs and holidayHrs populated', () => {
    const s = call({
      entry: entry('2026-04-19', '07:00', '18:00'), // 11h Sunday also flagged holiday
      publicHolidays: new Set(['2026-04-19']),
    });
    expect(s.sundayHrs).toBe(11);
    expect(s.holidayHrs).toBe(11);
    expect(s.regularHrs).toBe(9);
    expect(s.overtimeHrs).toBe(2);
  });

  it('bucket sum consistency — regular + overtime equals total worked (within 0.01)', () => {
    const s = call({ entry: entry('2026-04-20', '08:00', '19:30') }); // 11.5h
    expect(s.regularHrs + s.overtimeHrs).toBeCloseTo(11.5, 2);
  });

  it('fractional hours rounded to 2dp (7h35m → 7.58 regular)', () => {
    const s = call({ entry: entry('2026-04-20', '08:00', '15:35') });
    expect(s.regularHrs).toBe(7.58);
    expect(s.overtimeHrs).toBe(0);
  });
});

describe('calculateDailySummary — BCEA s6 exemption', () => {
  it('11h weekday, BCEA-exempt — all regular, no OT/Sunday/holiday/night', () => {
    const s = call({
      entry: entry('2026-04-20', '08:00', '19:00'),
      publicHolidays: new Set(['2026-04-20']),
      staffBceaApplicable: false,
    });
    expect(s.regularHrs).toBe(11);
    expect(s.overtimeHrs).toBe(0);
    expect(s.sundayHrs).toBe(0);
    expect(s.holidayHrs).toBe(0);
    expect(s.nightHrs).toBe(0);
    expect(s.computationMode).toBe('bcea_exempt');
  });

  it('exempt staff never trigger weeklyOvertimeOverCap', () => {
    const s = call({
      entry: entry('2026-04-20', '06:00', '20:00'), // 14h
      staffBceaApplicable: false,
      weeklyOvertimeHrsBefore: 50, // absurd, but exempt path never checks
    });
    expect(s.weeklyOvertimeOverCap).toBe(false);
  });
});

describe('calculateDailySummary — night hours (s17)', () => {
  it('shift fully at night (22:00 → 06:00 next day) — 8h night', () => {
    const s = call({
      entry: {
        workDate: '2026-04-20',
        clockInAt: sast('2026-04-20', '22:00'),
        clockOutAt: sast('2026-04-21', '06:00'),
      },
    });
    expect(s.nightHrs).toBe(8);
  });

  it('day shift (08:00 → 17:00) — 0h night', () => {
    const s = call({ entry: entry('2026-04-20', '08:00', '17:00') });
    expect(s.nightHrs).toBe(0);
  });

  it('mixed shift 16:00 → 02:00 — 8h night, regular 9 + OT 1', () => {
    const s = call({
      entry: {
        workDate: '2026-04-20',
        clockInAt: sast('2026-04-20', '16:00'),
        clockOutAt: sast('2026-04-21', '02:00'),
      },
    });
    expect(s.nightHrs).toBe(8);
    expect(s.regularHrs).toBe(9);
    expect(s.overtimeHrs).toBe(1);
  });

  it('shift crossing two night windows (20:00 Mon → 20:00 Tue, 24h) — 12h night total', () => {
    // Exercises the offsetDays scan across multiple days. 18:00 → 06:00 each
    // SAST day is 12h night; a 24h shift from 20:00 to 20:00 hits the tail
    // of night day-1 (2h), the wrap (6h + 0h), and a full 18:00→20:00 of
    // day-2 day period (0h night). Total: 2h (20-22 day1 before midnight is
    // actually IS night) … let me recompute: night = [18:00,06:00] wraps.
    //   20:00 Mon → 24:00 Mon: 4h night
    //   00:00 Tue → 06:00 Tue: 6h night
    //   06:00 Tue → 18:00 Tue: 0h night
    //   18:00 Tue → 20:00 Tue: 2h night
    //   Total: 12h
    const s = call({
      entry: {
        workDate: '2026-04-20',
        clockInAt: sast('2026-04-20', '20:00'),
        clockOutAt: sast('2026-04-21', '20:00'),
      },
    });
    // 24h is our MAX_PLAUSIBLE_SHIFT_HRS — exactly at boundary is allowed.
    expect(s.incomplete).toBe(false);
    expect(s.nightHrs).toBe(12);
  });
});

describe('calculateDailySummary — weekly cap detection (s10)', () => {
  it('OT pushes weekly total over cap — flag raised, not silently capped', () => {
    const s = call({
      entry: entry('2026-04-20', '06:00', '17:00'), // 11h → 2h OT
      weeklyOvertimeHrsBefore: 9, // 9 + 2 = 11 > 10 cap
    });
    expect(s.overtimeHrs).toBe(2);
    expect(s.weeklyOvertimeOverCap).toBe(true);
  });

  it('exactly at cap — flag unset (strict > comparison)', () => {
    const s = call({
      entry: entry('2026-04-20', '08:00', '18:00'), // 10h → 1h OT
      weeklyOvertimeHrsBefore: 9, // 9 + 1 = 10, strictly at cap
    });
    expect(s.overtimeHrs).toBe(1);
    expect(s.weeklyOvertimeOverCap).toBe(false);
  });

  it('one minute above cap — flag raised', () => {
    const s = call({
      entry: entry('2026-04-20', '08:00', '18:00'), // 10h → 1h OT
      weeklyOvertimeHrsBefore: 9.02, // 9.02 + 1 = 10.02 > 10
    });
    expect(s.weeklyOvertimeOverCap).toBe(true);
  });

  it('OT stays under weekly cap — flag unset', () => {
    const s = call({
      entry: entry('2026-04-20', '08:00', '18:00'),
      weeklyOvertimeHrsBefore: 2,
    });
    expect(s.overtimeHrs).toBe(1);
    expect(s.weeklyOvertimeOverCap).toBe(false);
  });
});

describe('calculateDailySummary — input validation', () => {
  it('NaN weeklyOvertimeHrsBefore throws (would otherwise silently bypass cap)', () => {
    expect(() =>
      call({ weeklyOvertimeHrsBefore: Number.NaN })
    ).toThrow(/weeklyOvertimeHrsBefore/);
  });

  it('negative weeklyOvertimeHrsBefore throws', () => {
    expect(() => call({ weeklyOvertimeHrsBefore: -1 })).toThrow(
      /weeklyOvertimeHrsBefore/
    );
  });

  it('Infinity weeklyOvertimeHrsBefore throws', () => {
    expect(() =>
      call({ weeklyOvertimeHrsBefore: Number.POSITIVE_INFINITY })
    ).toThrow(/weeklyOvertimeHrsBefore/);
  });

  it('undefined weeklyOvertimeHrsBefore defaults to 0 (cap still checked)', () => {
    const s = call({ entry: entry('2026-04-20', '08:00', '18:00') });
    expect(s.weeklyOvertimeOverCap).toBe(false);
  });

  it('degenerate night rule (nightStart === nightEnd) throws', () => {
    expect(() =>
      call({
        rule: { ...BCEA_RULE, nightStart: '00:00', nightEnd: '00:00' },
      })
    ).toThrow(/degenerate night rule/);
  });
});

describe('calculateDailySummary — incomplete entries', () => {
  it('open entry (clock-out null) — incomplete=true, zero buckets', () => {
    const s = call({ entry: entry('2026-04-20', '08:00', null) });
    expect(s.incomplete).toBe(true);
    expect(s.regularHrs).toBe(0);
    expect(s.overtimeHrs).toBe(0);
    expect(s.nightHrs).toBe(0);
  });

  it('zero-duration entry — incomplete=true', () => {
    const s = call({ entry: entry('2026-04-20', '08:00', '08:00') });
    expect(s.incomplete).toBe(true);
  });

  it('negative duration (clock-out before clock-in) — incomplete=true', () => {
    const s = call({
      entry: {
        workDate: '2026-04-20',
        clockInAt: sast('2026-04-20', '10:00'),
        clockOutAt: sast('2026-04-20', '09:00'),
      },
    });
    expect(s.incomplete).toBe(true);
    expect(s.regularHrs).toBe(0);
  });

  it('shift longer than 24h (missed clock-out) — incomplete=true, no runaway night hours', () => {
    const s = call({
      entry: {
        workDate: '2026-04-20',
        clockInAt: sast('2026-04-20', '08:00'),
        clockOutAt: sast('2026-04-21', '09:00'), // 25h
      },
    });
    expect(s.incomplete).toBe(true);
    expect(s.nightHrs).toBe(0);
    expect(s.regularHrs).toBe(0);
  });
});

describe('calculateDailySummary — rule + cross-midnight behaviour', () => {
  it('DailySummary carries the rule id for audit', () => {
    const s = call({ rule: { ...BCEA_RULE, id: 'alt-rule-99' } });
    expect(s.ruleId).toBe('alt-rule-99');
  });

  it('shift crossing midnight into a holiday does NOT dual-report holiday (workDate only)', () => {
    // Locks current behaviour: holidayHrs is keyed to entry.workDate. A
    // 16:00 Sun → 02:00 Mon shift where Monday is a holiday books zero
    // holiday hours. If the reconcile cron wants s18-accurate splitting,
    // it must pre-split the entry by SAST midnight before calling this
    // function. Changing this contract requires a new test.
    const s = call({
      entry: {
        workDate: '2026-04-19', // Sunday, the clock-in day
        clockInAt: sast('2026-04-19', '16:00'),
        clockOutAt: sast('2026-04-20', '02:00'), // Monday 02:00 local
      },
      publicHolidays: new Set(['2026-04-20']), // Monday is the holiday
    });
    expect(s.holidayHrs).toBe(0);
    // Sunday dual-reports (workDate = Sunday)
    expect(s.sundayHrs).toBe(10);
  });
});

// Intentional stubs so coverage gaps are visible in test output without
// failing CI. Phase 1b PR B / later work picks these up.
describe.todo('s11 averaging agreement (45h/week averaged over 4 months)');
describe.todo('s17 opt-out for staff whose ordinary hours include night work');
describe.todo('computationMode reflects staffOrdinarilyWorksSundays flag (export-side today)');
