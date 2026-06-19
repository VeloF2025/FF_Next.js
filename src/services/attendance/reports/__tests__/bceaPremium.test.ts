/**
 * Unit tests for runBceaPremium row-building logic (#1990 disjoint-bucket
 * model + #2028 cross-midnight date/label attribution).
 *
 * Faithfulness contract (#2028 finding #3): the mocked DB rows must carry only
 * what the production SQL actually produces. The query DERIVES the premium
 * calendar day in SQL and resolves the holiday name on the DERIVED holiday day:
 *   - sunday_date  = work_date if it's a Sunday, else work_date + 1
 *   - holiday_date = work_date if it's a public holiday, else work_date + 1
 *   - holiday_name = public_holidays.name JOINed on holiday_date (NULL when
 *     holiday_date is not a seeded holiday)
 * The old tests mocked a holiday_name that the join keyed to the clock-in day
 * could never return — that masked the wrong-date/label bug. These rows model
 * the corrected query output instead.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({
  sqlMock: { query: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: sqlMock }));

import { runBceaPremium } from '../bceaPremium';

const BASE_INPUT = {
  dateFrom: '2026-04-01',
  dateTo: '2026-04-30',
  scopedStaffIds: null,
  departments: [],
  siteIds: [],
};

/**
 * Models a row as the production query emits it. Defaults describe a whole-day
 * Sunday on 2026-04-19 (clock-in day == Sunday == premium day, no holiday).
 */
function dbRow(overrides: Record<string, unknown>) {
  return {
    work_date: '2026-04-19',
    staff_id: 'staff-1',
    full_name: 'Test Worker',
    department: 'Ops',
    ordinarily_works_sundays: false,
    sunday_date: '2026-04-19',
    holiday_date: '2026-04-20', // work_date+1 when work_date is not a holiday
    holiday_name: null,
    sunday_hrs: '0',
    holiday_hrs: '0',
    hourly_rate_cents: '12000',
    ...overrides,
  };
}

beforeEach(() => {
  sqlMock.query.mockReset();
});

describe('runBceaPremium — row emission (#1990 disjoint, #2028 attribution)', () => {
  it('pure Sunday shift — one Sunday row, dated on the Sunday', async () => {
    sqlMock.query.mockResolvedValue([
      dbRow({ sunday_hrs: '8', holiday_hrs: '0' }),
    ]);
    const result = await runBceaPremium(BASE_INPUT);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      work_date: '2026-04-19',
      day_type: 'Sunday',
      hours_worked: 8,
      multiplier: 2.0,
      premium_amount_rand: (8 * 2.0 * 12000) / 100,
    });
  });

  it('pure holiday weekday — one Holiday row, dated and named on the holiday', async () => {
    // Freedom Day 2026-04-27 (Mon). work_date == holiday day.
    sqlMock.query.mockResolvedValue([
      dbRow({
        work_date: '2026-04-27',
        sunday_date: '2026-04-28', // not a Sunday; irrelevant (sunday_hrs=0)
        holiday_date: '2026-04-27',
        holiday_name: 'Freedom Day',
        sunday_hrs: '0',
        holiday_hrs: '9',
      }),
    ]);
    const result = await runBceaPremium(BASE_INPUT);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      work_date: '2026-04-27',
      day_type: 'Freedom Day',
      hours_worked: 9,
      multiplier: 2.0,
    });
  });

  it('cross-midnight Sat→Sun — Sunday row attributed to work_date+1 (#2028)', async () => {
    // Clock in Sat 2026-04-18, Sunday hours fall on 2026-04-19.
    sqlMock.query.mockResolvedValue([
      dbRow({
        work_date: '2026-04-18',
        sunday_date: '2026-04-19',
        holiday_date: '2026-04-19', // not a holiday → name NULL
        holiday_name: null,
        sunday_hrs: '6',
        holiday_hrs: '0',
      }),
    ]);
    const result = await runBceaPremium(BASE_INPUT);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      work_date: '2026-04-19', // NOT the clock-in day 2026-04-18
      day_type: 'Sunday',
      hours_worked: 6,
    });
  });

  it('cross-midnight weekday→holiday — Holiday row dated/named on work_date+1 (#2028)', async () => {
    // Thu 2026-04-30 → Workers' Day 2026-05-01. Holiday hours fall on 05-01.
    sqlMock.query.mockResolvedValue([
      dbRow({
        work_date: '2026-04-30',
        sunday_date: '2026-05-01', // not a Sunday; irrelevant
        holiday_date: '2026-05-01',
        holiday_name: "Workers' Day",
        sunday_hrs: '0',
        holiday_hrs: '6',
      }),
    ]);
    const result = await runBceaPremium(BASE_INPUT);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      work_date: '2026-05-01', // NOT the clock-in day 2026-04-30
      day_type: "Workers' Day",
      hours_worked: 6,
      multiplier: 2.0,
    });
  });

  it('cross-midnight Sunday→holiday (both > 0) — two rows on their own days (#2028)', async () => {
    // Clock in Sun 2026-04-19 16:00 → Mon-holiday 2026-04-20 02:00.
    // sunday_hrs land on 2026-04-19, holiday_hrs on 2026-04-20.
    sqlMock.query.mockResolvedValue([
      dbRow({
        work_date: '2026-04-19',
        sunday_date: '2026-04-19',
        holiday_date: '2026-04-20',
        holiday_name: 'Freedom Day',
        sunday_hrs: '8',
        holiday_hrs: '2',
      }),
    ]);
    const result = await runBceaPremium(BASE_INPUT);
    expect(result.rows).toHaveLength(2);
    const sundayRow = result.rows.find((r) => r.day_type === 'Sunday');
    const holidayRow = result.rows.find((r) => r.day_type === 'Freedom Day');
    expect(sundayRow).toMatchObject({ work_date: '2026-04-19', hours_worked: 8, multiplier: 2.0 });
    expect(holidayRow).toMatchObject({ work_date: '2026-04-20', hours_worked: 2, multiplier: 2.0 });
  });

  it('holiday-on-Sunday (sundayHrs=0 after disjoint fix) — one holiday row', async () => {
    // Good Friday example shape: holiday wins, sunday_hrs=0 from calculator.
    sqlMock.query.mockResolvedValue([
      dbRow({
        work_date: '2026-04-19',
        sunday_date: '2026-04-19',
        holiday_date: '2026-04-19',
        holiday_name: 'Family Day',
        sunday_hrs: '0',
        holiday_hrs: '11',
      }),
    ]);
    const result = await runBceaPremium(BASE_INPUT);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      work_date: '2026-04-19',
      day_type: 'Family Day',
      hours_worked: 11,
      multiplier: 2.0,
    });
  });

  it('ordinarilyWorksSundays=true uses 1.5× multiplier for Sunday row', async () => {
    sqlMock.query.mockResolvedValue([
      dbRow({ sunday_hrs: '8', holiday_hrs: '0', ordinarily_works_sundays: true }),
    ]);
    const result = await runBceaPremium(BASE_INPUT);
    expect(result.rows[0]).toMatchObject({ multiplier: 1.5 });
  });

  it('missing hourly rate — premium amount 0, note counts OUTPUT rows not DB rows', async () => {
    // One DB row with both buckets → two output rows, both R0 → note says "2".
    sqlMock.query.mockResolvedValue([
      dbRow({
        work_date: '2026-04-19',
        sunday_date: '2026-04-19',
        holiday_date: '2026-04-20',
        holiday_name: 'Freedom Day',
        sunday_hrs: '8',
        holiday_hrs: '2',
        hourly_rate_cents: null,
      }),
    ]);
    const result = await runBceaPremium(BASE_INPUT);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.premium_amount_rand === 0)).toBe(true);
    expect(result.notes.some((n: string) => /^2 row\(s\) had no captured hourly rate/.test(n))).toBe(true);
  });

  it('holiday hours with NULL holiday_name fall back to generic label', async () => {
    // Defensive: if the derived holiday day somehow has no seeded name.
    sqlMock.query.mockResolvedValue([
      dbRow({
        work_date: '2026-04-30',
        holiday_date: '2026-05-01',
        holiday_name: null,
        sunday_hrs: '0',
        holiday_hrs: '6',
      }),
    ]);
    const result = await runBceaPremium(BASE_INPUT);
    expect(result.rows[0]).toMatchObject({
      work_date: '2026-05-01',
      day_type: 'Public holiday',
    });
  });
});
