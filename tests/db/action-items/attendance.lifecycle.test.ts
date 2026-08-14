/**
 * Attendance queries against REAL Postgres.
 *
 * Two of the defects found while building this were invisible to any assertion on the
 * generated SQL, and both changed the numbers a person would read:
 *
 *   - a plain join to attendance_day_exceptions duplicated every day carrying two
 *     exceptions (154 of them live), inflating the day count and DOUBLE-COUNTING hours;
 *   - anchoring `exceptions` mode on attendance_daily_summaries hid the 53 exception-days
 *     that have no summary, which silently made include_resolved a no-op.
 *
 * Both are row-shape facts. Only executing the query finds them.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { parseAttendanceFilter } from '@/lib/reporting/attendanceFilter';
import { attendanceQuery, shapeAttendance } from '@/lib/reporting/attendance';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const GONE = '33333333-3333-4333-8333-333333333333';

describe('attendance queries (real Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
      options: '-c search_path=att_rt,public',
    });

    await pool.query(`
      DROP SCHEMA IF EXISTS att_rt CASCADE;
      CREATE SCHEMA att_rt;

      CREATE TABLE att_rt.staff (
        id UUID PRIMARY KEY, name TEXT, first_name TEXT, last_name TEXT,
        role TEXT, status TEXT
      );
      CREATE TABLE att_rt.attendance_daily_summaries (
        staff_id UUID, work_date DATE,
        regular_hrs NUMERIC(5,2), overtime_hrs NUMERIC(5,2),
        sunday_hrs NUMERIC(5,2), holiday_hrs NUMERIC(5,2),
        result_status TEXT,
        -- Present in the fixture precisely so a test can prove they are NOT selected.
        wage_amount_cents BIGINT, hourly_rate_snapshot_cents BIGINT
      );
      CREATE TABLE att_rt.attendance_day_exceptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        staff_id UUID, work_date DATE, kind TEXT, status TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      INSERT INTO att_rt.staff (id, name, role, status) VALUES
        ('${ALICE}', 'Alice Employee', NULL,         'active'),
        ('${BOB}',   'Bob Fieldworker','technician', 'active'),
        ('${GONE}',  'Gone Leaver',    NULL,         'resigned');

      INSERT INTO att_rt.attendance_daily_summaries
        (staff_id, work_date, regular_hrs, overtime_hrs, sunday_hrs, holiday_hrs, result_status, wage_amount_cents, hourly_rate_snapshot_cents) VALUES
        ('${ALICE}','2026-08-10', 8.00, 0.00, 0, 0, 'approved',    120000, 15000),
        ('${ALICE}','2026-08-11', 8.00, 1.50, 0, 0, NULL,          130000, 15000),
        ('${BOB}',  '2026-08-10', 7.00, 0.00, 0, 0, 'approved',     90000, 12000),
        ('${GONE}', '2026-08-10', 6.00, 0.00, 0, 0, 'approved',     70000, 11000);

      -- 2026-08-11 for Alice carries TWO exceptions: the fan-out case.
      INSERT INTO att_rt.attendance_day_exceptions (staff_id, work_date, kind, status) VALUES
        ('${ALICE}','2026-08-11','missing_clock_in','awaiting_supervisor'),
        ('${ALICE}','2026-08-11','late_arrival',    'awaiting_supervisor'),
        -- Bob has an exception day with NO summary row, and it is fully cancelled.
        ('${BOB}',  '2026-08-09','missing_clock_in','cancelled');
    `);
  });

  afterAll(async () => {
    await pool.query('DROP SCHEMA IF EXISTS att_rt CASCADE;');
    await pool.end();
  });

  async function report(query: Record<string, string> = {}) {
    const parsed = parseAttendanceFilter(query);
    if ('error' in parsed) throw new Error(parsed.error);
    const { sql, params } = attendanceQuery(parsed.filter);
    const { rows } = await pool.query(sql, params);
    return shapeAttendance(rows as never, parsed.filter);
  }

  describe('person mode', () => {
    it('returns one row per day, even when a day has two exceptions', async () => {
      // The fan-out. Alice has 2 summary days; a plain join would return 3 rows and
      // report 16+8 = 24 regular hours instead of 16.
      const r = await report({ person: 'Alice' });
      expect(r.totals.daysShown).toBe(2);
      expect(r.totals.daysMatched).toBe(2);
      expect(r.totals.regularHours).toBe(16);
    });

    it('carries both exceptions on the day that has two', async () => {
      const r = await report({ person: 'Alice' });
      const day = r.days.find((d) => d.date === '2026-08-11');
      expect(day?.exceptions).toHaveLength(2);
    });

    it('leaves a day with NO exception empty', async () => {
      // Without this, dropping the work_date correlation from the lateral — so every day
      // inherits all of that person's exceptions — passes unnoticed: the day that really
      // has two still has two.
      const r = await report({ person: 'Alice' });
      const clean = r.days.find((d) => d.date === '2026-08-10');
      expect(clean?.exceptions).toEqual([]);
    });

    it('includes field workers', async () => {
      // hrVisibilityFilters hides role IN ('technician','casual') from HR surfaces; that
      // predicate is deliberately not applied here.
      const r = await report({ person: 'Bob' });
      expect(r.days.map((d) => d.name)).toContain('Bob Fieldworker');
      expect(r.days[0].role).toBe('technician');
    });

    it('includes people who have left, and flags them', async () => {
      const r = await report({ person: 'Gone' });
      expect(r.totals.daysShown).toBe(1);
      expect(r.days[0].employmentStatus).toBe('resigned');
      expect(r.caveats.join(' ')).toContain('no longer active');
    });

    it('orders a person timeline oldest first', async () => {
      const dates = (await report({ person: 'Alice' })).days.map((d) => d.date);
      expect(dates).toEqual(['2026-08-10', '2026-08-11']);
    });

    it('dates the day correctly rather than a day early', async () => {
      const r = await report({ person: 'Gone' });
      expect(r.days[0].date).toBe('2026-08-10');
    });
  });

  describe('roster mode', () => {
    it('returns everyone who worked on the day', async () => {
      const r = await report({ mode: 'roster', since: '2026-08-10', until: '2026-08-10' });
      expect(r.totals.peopleShown).toBe(3);
      expect(r.days.map((d) => d.name).sort()).toEqual(['Alice Employee', 'Bob Fieldworker', 'Gone Leaver']);
    });

    it('excludes days outside the range', async () => {
      const r = await report({ mode: 'roster', since: '2026-08-11', until: '2026-08-11' });
      expect(r.days.map((d) => d.name)).toEqual(['Alice Employee']);
    });
  });

  describe('exceptions mode', () => {
    it('returns only days with an exception', async () => {
      const r = await report({ mode: 'exceptions' });
      // Alice's 11th (2 unresolved). Bob's 9th is cancelled, so excluded by default.
      expect(r.days.map((d) => d.date)).toEqual(['2026-08-11']);
    });

    it('surfaces a resolved-only day when asked — INCLUDING one with no summary', async () => {
      // The defect this catches: anchored on summaries, Bob's 9th was invisible and
      // include_resolved changed nothing at all.
      const r = await report({ mode: 'exceptions', includeResolved: 'true' });
      const dates = r.days.map((d) => d.date).sort();
      expect(dates).toEqual(['2026-08-09', '2026-08-11']);
    });

    it('reports null hours for an exception day that has no summary', async () => {
      // Not zero. Zero would say "worked no hours"; null says "no hours were computed".
      const r = await report({ mode: 'exceptions', includeResolved: 'true' });
      const orphan = r.days.find((d) => d.date === '2026-08-09');
      expect(orphan?.regularHours).toBeNull();
      expect(orphan?.name).toBe('Bob Fieldworker');
    });

    it('include_resolved actually changes the result', async () => {
      const strict = await report({ mode: 'exceptions' });
      const loose = await report({ mode: 'exceptions', includeResolved: 'true' });
      expect(loose.totals.daysMatched).toBeGreaterThan(strict.totals.daysMatched);
    });
  });

  describe('what never comes back', () => {
    it('returns no pay figure, even though the fixture has one', async () => {
      // The fixture deliberately carries wage_amount_cents and hourly_rate_snapshot_cents.
      const r = await report({});
      const serialised = JSON.stringify(r);
      expect(serialised).not.toContain('120000');
      expect(serialised).not.toContain('15000');
      expect(serialised).not.toContain('wage');
      expect(serialised).not.toContain('rate');
    });

    it('does not even fetch the pay columns into the ROW', async () => {
      // Asserting on the shaped report alone is not enough: shapeAttendance maps named
      // fields, so a pay column added to the SELECT would sit unnoticed in the raw row
      // until someone spreads it into the response.
      const parsed = parseAttendanceFilter({});
      if ('error' in parsed) throw new Error(parsed.error);
      const { sql, params } = attendanceQuery(parsed.filter);
      const { rows } = await pool.query(sql, params);
      const keys = Object.keys(rows[0] ?? {});
      expect(keys).not.toContain('wage_amount_cents');
      expect(keys).not.toContain('hourly_rate_snapshot_cents');
    });
  });

  describe('inputs that must not widen', () => {
    it('a bare % matches nothing rather than everyone', async () => {
      expect((await report({ person: '%' })).totals.daysShown).toBe(0);
    });

    it('an injection attempt returns nothing', async () => {
      expect((await report({ person: "' OR 1=1 --" })).totals.daysShown).toBe(0);
    });

    it('the limit caps the rows returned but not the total reported', async () => {
      const r = await report({ limit: '1' });
      expect(r.totals.daysShown).toBe(1);
      expect(r.totals.daysMatched).toBe(4);
      expect(r.caveats.join(' ')).toContain('of 4');
    });
  });
});
