import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import {
  loadEffectivePolicy,
  loadExpectedAttendanceDays,
  type AttendancePolicyReader,
} from '../reconcileQueries';

const ENABLED = process.env.SUPABASE_INTEGRATION_TEST === 'true';
const UUID = '00000000-0000-0000-0000-000000000000';
const DATE = '2026-08-03';

interface Template {
  name: string;
  text: string;
  params: unknown[];
}

const TEMPLATES: Template[] = [
  {
    name: 'load active default overtime rule',
    text: `
      SELECT id, daily_ordinary_hrs, weekly_ordinary_hrs, weekly_ot_cap_hrs,
             ot_multiplier, sunday_multiplier_default, sunday_ordinary_multiplier,
             holiday_multiplier, night_shift_allowance,
             TO_CHAR(night_start, 'HH24:MI') AS night_start,
             TO_CHAR(night_end, 'HH24:MI') AS night_end
      FROM attendance_overtime_rules
      WHERE is_default = true AND is_active = true
      LIMIT 1`,
    params: [],
  },
  {
    name: 'load open entries by work-date range',
    text: `
      SELECT id, staff_id, TO_CHAR(work_date, 'YYYY-MM-DD') AS work_date
      FROM attendance_entries
      WHERE status = 'open'
        AND work_date >= $1::date AND work_date <= $2::date
        AND work_date < (NOW() AT TIME ZONE 'Africa/Johannesburg')::date
        AND EXISTS (
          SELECT 1 FROM attendance_schedule_policies
          WHERE active_from <= work_date
            AND (active_to IS NULL OR active_to >= work_date)
        )
      ORDER BY staff_id ASC, work_date ASC, clock_in_at ASC`,
    params: [DATE, DATE],
  },
  {
    name: 'load entry evidence and existing projection identity',
    text: `
      SELECT e.id, e.staff_id, TO_CHAR(e.work_date, 'YYYY-MM-DD') AS work_date,
             e.clock_in_at::text, e.clock_out_at::text, e.status,
             COALESCE(s.bcea_applicable, true) AS bcea_applicable,
             COALESCE(s.ordinarily_works_sundays, false) AS ordinarily_works_sundays,
             COALESCE((rac.hourly_rate_cents::numeric / 100)::text, s.hourly_rate::text) AS hourly_rate,
             ds.calculation_fingerprint, ds.result_version
      FROM attendance_entries e
      JOIN staff s ON s.id = e.staff_id
      LEFT JOIN staff_rate_at_clock_in rac ON rac.entry_id = e.id
      LEFT JOIN attendance_daily_summaries ds ON ds.staff_id = e.staff_id AND ds.work_date = e.work_date
      WHERE e.status IN ('open', 'closed', 'auto_closed', 'manual')
        AND e.work_date >= $1::date AND e.work_date <= $2::date
      ORDER BY e.staff_id ASC, e.work_date ASC, e.clock_in_at ASC`,
    params: [DATE, DATE],
  },
  {
    name: 'load expected attendance days and existing projection identity',
    text: `
      WITH workdays AS (
        SELECT day::date AS work_date
        FROM generate_series($1::date, $2::date, INTERVAL '1 day') AS days(day)
        WHERE EXTRACT(ISODOW FROM day) BETWEEN 1 AND 6
      )
      SELECT s.id AS staff_id, TO_CHAR(w.work_date, 'YYYY-MM-DD') AS work_date,
             (ph.date IS NOT NULL) AS is_public_holiday, ph.name AS public_holiday_name,
             ds.calculation_fingerprint, ds.result_version
      FROM staff s CROSS JOIN workdays w
      LEFT JOIN public_holidays ph ON ph.date = w.work_date
      LEFT JOIN attendance_daily_summaries ds ON ds.staff_id = s.id AND ds.work_date = w.work_date
      WHERE s.attendance_tracked = true
        AND (s.is_active = true OR s.is_active IS NULL) AND s.end_date IS NULL
      ORDER BY w.work_date ASC, s.id ASC`,
    params: [DATE, DATE],
  },
  {
    name: 'load legacy weekly overtime seed',
    text: `
      SELECT SUM(overtime_hrs)::text AS total
      FROM attendance_daily_summaries
      WHERE staff_id = $1::uuid AND work_date >= $2::date AND work_date < $3::date`,
    params: [UUID, DATE, DATE],
  },
  {
    name: 'system close without clock-out evidence writes',
    text: `
      UPDATE attendance_entries
      SET status = 'auto_closed',
          notes = CONCAT_WS(E'\n', NULLIF(notes, ''),
            '[system: attendance reconciliation operational closure; clock-out evidence absent]'),
          updated_at = NOW()
      WHERE id = $1::uuid
        AND work_date = $2::date
        AND status = 'open'
        AND work_date < (NOW() AT TIME ZONE 'Africa/Johannesburg')::date
        AND EXISTS (
          SELECT 1 FROM attendance_schedule_policies
          WHERE active_from <= attendance_entries.work_date
            AND (active_to IS NULL OR active_to >= attendance_entries.work_date)
        )
      RETURNING id`,
    params: [UUID, DATE],
  },
  {
    name: 'start reconciliation audit run',
    text: `
      INSERT INTO attendance_reconciliation_runs (
        run_id, scanned_from, scanned_to, status, counts, failed_day_keys, started_at
      ) VALUES ($1, $2::date, $3::date, 'running', $4::jsonb, $5::jsonb, $6::timestamptz)
      RETURNING id`,
    params: ['run-1', DATE, DATE, '{}', '[]', '2026-08-04T00:45:00Z'],
  },
  {
    name: 'finish reconciliation audit run',
    text: `
      UPDATE attendance_reconciliation_runs
      SET schedule_policy_id = $2::uuid, status = $3, counts = $4::jsonb,
          failed_day_keys = $5::jsonb, error_message = $6, finished_at = $7::timestamptz
      WHERE run_id = $1 AND status = 'running'
      RETURNING id`,
    params: ['run-1', UUID, 'succeeded', '{}', '[]', null, '2026-08-04T00:46:00Z'],
  },
  {
    name: 'upsert legacy BCEA shadow fields',
    text: `
      INSERT INTO attendance_daily_summaries (
        staff_id, work_date, regular_hrs, overtime_hrs, sunday_hrs, holiday_hrs,
        night_hrs, rule_id, computation_mode, wage_amount_cents,
        hourly_rate_snapshot_cents, computed_at
      ) VALUES ($1::uuid, $2::date, $3, $4, $5, $6, $7, $8::uuid, $9, $10, $11, NOW())
      ON CONFLICT (staff_id, work_date) DO UPDATE
        SET regular_hrs = EXCLUDED.regular_hrs, overtime_hrs = EXCLUDED.overtime_hrs,
            sunday_hrs = EXCLUDED.sunday_hrs, holiday_hrs = EXCLUDED.holiday_hrs,
            night_hrs = EXCLUDED.night_hrs, rule_id = EXCLUDED.rule_id,
            computation_mode = EXCLUDED.computation_mode,
            wage_amount_cents = EXCLUDED.wage_amount_cents,
            hourly_rate_snapshot_cents = EXCLUDED.hourly_rate_snapshot_cents,
            computed_at = EXCLUDED.computed_at`,
    params: [UUID, DATE, 8, 0, 0, 0, 0, UUID, 'bcea_default', null, null],
  },
];

describe.skipIf(!ENABLED)('attendance reconciliation SQL live-schema gate', () => {
  let pool: Pool;

  beforeAll(() => {
    const url = process.env.SUPABASE_INTEGRATION_DB_URL;
    if (!url) throw new Error('SUPABASE_INTEGRATION_DB_URL is required for the live gate');
    pool = new Pool({ connectionString: url });
  });

  afterAll(async () => pool?.end());

  for (const template of TEMPLATES) {
    it(`EXPLAIN parses ${template.name}`, async () => {
      await expect(pool.query(`EXPLAIN (VERBOSE) ${template.text}`, template.params))
        .resolves.toBeDefined();
    });
  }

  const reader: AttendancePolicyReader = async <T extends Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> => (await pool.query(text, params)).rows as T[];

  it('reads the effective fixed SAST policy through the production mapping', async () => {
    await expect(loadEffectivePolicy(DATE, reader)).resolves.toMatchObject({
      timezone: 'Africa/Johannesburg', weekdayPaidCapHours: 8, saturdayPaidCapHours: 5,
    });
  });

  it('reads explicit chronological expected-day strings through production mapping', async () => {
    const days = await loadExpectedAttendanceDays('2026-08-03', '2026-08-08', reader);
    expect(days).not.toHaveLength(0);
    expect(days.every((day) => /^2026-08-0[3-8]$/.test(day.work_date))).toBe(true);
    expect(days.map((day) => `${day.work_date}:${day.staff_id}`)).toEqual(
      [...days].sort((a, b) => `${a.work_date}:${a.staff_id}`.localeCompare(`${b.work_date}:${b.staff_id}`))
        .map((day) => `${day.work_date}:${day.staff_id}`),
    );
  });
});

describe.skipIf(ENABLED)('attendance reconciliation SQL live-schema gate disabled', () => {
  it('does not present static SQL as live database proof', () => {
    expect(ENABLED).toBe(false);
  });
});
