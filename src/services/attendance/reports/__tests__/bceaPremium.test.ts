/**
 * Unit tests for runBceaPremium row-building logic (#1990 disjoint-bucket model).
 *
 * With the disjoint-bucket fix, sunday_hrs and holiday_hrs never overlap for
 * the same hour. For a cross-midnight Sunday→holiday shift both are > 0 but
 * cover different hours — we must emit TWO rows (additive), not one (max).
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

function dbRow(overrides: Record<string, unknown>) {
  return {
    work_date: '2026-04-19',
    staff_id: 'staff-1',
    full_name: 'Test Worker',
    department: 'Ops',
    ordinarily_works_sundays: false,
    is_sunday: true,
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

describe('runBceaPremium — row emission (#1990 disjoint model)', () => {
  it('pure Sunday shift — emits one Sunday row', async () => {
    sqlMock.query.mockResolvedValue([
      dbRow({ sunday_hrs: '8', holiday_hrs: '0' }),
    ]);
    const result = await runBceaPremium(BASE_INPUT);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      day_type: 'Sunday',
      hours_worked: 8,
      multiplier: 2.0,
      premium_amount_rand: (8 * 2.0 * 12000) / 100,
    });
  });

  it('pure holiday weekday — emits one Holiday row', async () => {
    sqlMock.query.mockResolvedValue([
      dbRow({ sunday_hrs: '0', holiday_hrs: '9', holiday_name: 'Freedom Day', is_sunday: false }),
    ]);
    const result = await runBceaPremium(BASE_INPUT);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      day_type: 'Freedom Day',
      hours_worked: 9,
      multiplier: 2.0,
    });
  });

  it('cross-midnight Sunday→holiday (both > 0) — emits TWO rows additive', async () => {
    // Sun 16:00→Mon-holiday 02:00: sundayHrs=8, holidayHrs=2 (disjoint).
    sqlMock.query.mockResolvedValue([
      dbRow({
        sunday_hrs: '8',
        holiday_hrs: '2',
        holiday_name: 'Freedom Day',
        is_sunday: true,
      }),
    ]);
    const result = await runBceaPremium(BASE_INPUT);
    expect(result.rows).toHaveLength(2);
    const sundayRow = result.rows.find((r) => r.day_type === 'Sunday');
    const holidayRow = result.rows.find((r) => r.day_type === 'Freedom Day');
    expect(sundayRow).toBeDefined();
    expect(holidayRow).toBeDefined();
    expect(sundayRow).toMatchObject({ hours_worked: 8, multiplier: 2.0 });
    expect(holidayRow).toMatchObject({ hours_worked: 2, multiplier: 2.0 });
  });

  it('holiday-on-Sunday (sundayHrs=0 after disjoint fix) — emits ONE holiday row', async () => {
    // After #1990, holiday-on-Sunday produces sundayHrs=0, holidayHrs=11.
    sqlMock.query.mockResolvedValue([
      dbRow({
        sunday_hrs: '0',
        holiday_hrs: '11',
        holiday_name: 'Good Friday',
        is_sunday: true,
      }),
    ]);
    const result = await runBceaPremium(BASE_INPUT);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      day_type: 'Good Friday',
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

  it('missing hourly rate — premium amount is 0, note appended', async () => {
    sqlMock.query.mockResolvedValue([
      dbRow({ sunday_hrs: '8', holiday_hrs: '0', hourly_rate_cents: null }),
    ]);
    const result = await runBceaPremium(BASE_INPUT);
    expect(result.rows[0].premium_amount_rand).toBe(0);
    expect(result.notes.some((n: string) => /missing|no captured/i.test(n))).toBe(true);
  });
});
