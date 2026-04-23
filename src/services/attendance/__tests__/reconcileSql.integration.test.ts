/**
 * Live-DB integration test for the attendance reconcile SQL templates.
 *
 * The existing unit tests mock `sql`, so schema drift in any of the
 * reconcile templates only surfaces at cron time (see PR #1400 — a
 * `va.vehicle_id` that should have been `va.fleet_vehicle_id` shipped
 * to dev and broke the first live cron run).
 *
 * This test runs `EXPLAIN (VERBOSE)` for every production SQL template
 * that the reconcile cron hits. EXPLAIN without ANALYZE parses and plans
 * the query against the real schema — it validates table names, column
 * names, function refs, and parameter types — but does NOT execute the
 * statement. Writes (INSERT/UPDATE) are planned, not applied, so the
 * test is safe to run against any database.
 *
 * Gating: skipped unless `SUPABASE_INTEGRATION_TEST=true` in the env.
 * Requires `SUPABASE_INTEGRATION_DB_URL` to be set — a separate var
 * because vitest.setup.ts forcibly overwrites `DATABASE_URL` to a
 * dummy value for unit-test isolation. Intended to run in CI behind
 * the gate, and locally via:
 *
 *   SUPABASE_INTEGRATION_TEST=true \
 *   SUPABASE_INTEGRATION_DB_URL=postgresql://... \
 *     npx vitest run src/services/attendance/__tests__/reconcileSql.integration.test.ts
 *
 * The SQL texts below are duplicated from the production files on
 * purpose: the duplication forces whoever edits a production query to
 * also update this gate, and the test will fail loud if the duplicated
 * text no longer parses against the live schema. When both sides agree
 * AND Postgres accepts the plan, the template is known to be valid.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { Pool } from 'pg';

const INTEGRATION_ENABLED = process.env.SUPABASE_INTEGRATION_TEST === 'true';

// Stable-ish params for EXPLAIN binding. Content doesn't matter beyond
// satisfying the type system — EXPLAIN never dereferences them.
const SAMPLE_UUID = '00000000-0000-0000-0000-000000000000';
const SAMPLE_DATE = '2026-04-01';
const SAMPLE_TIMESTAMPTZ = '2026-04-01T08:00:00Z';

interface Template {
  name: string;
  text: string;
  params: unknown[];
}

// ---------------------------------------------------------------------------
// Templates mirror the production SQL in:
//   src/services/attendance/reconcileQueries.ts
//   src/services/attendance/reconcileWriters.ts
//   src/services/attendance/cartrackReconcileQueries.ts
// Parameter positions match what `sql` renders from the template literals.
// ---------------------------------------------------------------------------

const TEMPLATES: Template[] = [
  {
    name: 'loadDefaultRule',
    text: `
      SELECT id, daily_ordinary_hrs, weekly_ordinary_hrs, weekly_ot_cap_hrs,
             ot_multiplier, sunday_multiplier_default, sunday_ordinary_multiplier,
             holiday_multiplier, night_shift_allowance,
             TO_CHAR(night_start, 'HH24:MI') AS night_start,
             TO_CHAR(night_end,   'HH24:MI') AS night_end
      FROM attendance_overtime_rules
      WHERE is_default = true AND is_active = true
      LIMIT 1`,
    params: [],
  },
  {
    name: 'loadOpenEntriesOlderThan',
    text: `
      SELECT id, staff_id, clock_in_at::text, work_date::text
      FROM attendance_entries
      WHERE status = 'open'
        AND clock_in_at < NOW() - ($1::int * INTERVAL '1 hour')
      ORDER BY clock_in_at ASC`,
    params: [24],
  },
  {
    name: 'loadClosedEntriesMissingSummary',
    text: `
      SELECT e.id,
             e.staff_id,
             e.work_date::text,
             e.clock_in_at::text,
             e.clock_out_at::text,
             COALESCE(s.bcea_applicable, true) AS bcea_applicable,
             COALESCE(s.ordinarily_works_sundays, false) AS ordinarily_works_sundays,
             s.hourly_rate::text AS hourly_rate
      FROM attendance_entries e
      JOIN staff s ON s.id = e.staff_id
      LEFT JOIN attendance_daily_summaries ds
        ON ds.staff_id = e.staff_id AND ds.work_date = e.work_date
      WHERE e.status IN ('closed', 'auto_closed', 'manual')
        AND e.clock_out_at IS NOT NULL
        AND e.work_date >= $1::date
        AND e.work_date <= $2::date
        AND ds.computed_at IS NULL
      ORDER BY e.staff_id ASC, e.work_date ASC, e.clock_in_at ASC`,
    params: [SAMPLE_DATE, SAMPLE_DATE],
  },
  {
    name: 'loadPersistedWeeklyOtBefore',
    text: `
      SELECT SUM(overtime_hrs)::text AS total
      FROM attendance_daily_summaries
      WHERE staff_id = $1
        AND work_date >= $2::date
        AND work_date <  $3::date`,
    params: [SAMPLE_UUID, SAMPLE_DATE, SAMPLE_DATE],
  },
  {
    name: 'autoCloseOneEntry — UPDATE',
    text: `
      UPDATE attendance_entries
      SET status          = 'auto_closed',
          clock_out_at    = $1,
          received_at_out = NOW(),
          updated_at      = NOW(),
          notes           = COALESCE(notes, '') ||
                            CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE E'\n' END ||
                            '[auto-closed by reconcile cron at ' || NOW()::text || ']'
      WHERE id = $2 AND status = 'open'
      RETURNING id`,
    params: [SAMPLE_TIMESTAMPTZ, SAMPLE_UUID],
  },
  {
    name: 'autoCloseOneEntry — INSERT exception',
    // $1/$4 need explicit casts for EXPLAIN's parser; prod code supplies
    // types via the pg extended-query protocol. Casts are test-only, not
    // required in production (see `reconcileWriters.ts`).
    text: `
      INSERT INTO attendance_exceptions (entry_id, exception_kind, severity, details)
      VALUES (
        $1::uuid,
        'missing_clock_out',
        'warning',
        jsonb_build_object(
          'auto_close_after_hrs', $2::int,
          'cap_hrs', $3::int,
          'original_clock_in_at', $4::text
        )
      )`,
    params: [SAMPLE_UUID, 18, 24, SAMPLE_TIMESTAMPTZ],
  },
  {
    name: 'upsertSummary',
    text: `
      INSERT INTO attendance_daily_summaries (
        staff_id, work_date,
        regular_hrs, overtime_hrs, sunday_hrs, holiday_hrs, night_hrs,
        rule_id, computation_mode,
        wage_amount_cents, hourly_rate_snapshot_cents,
        computed_at
      ) VALUES (
        $1::uuid, $2::date,
        $3, $4,
        $5, $6, $7,
        $8::uuid, $9,
        $10::bigint, $11::bigint,
        NOW()
      )
      ON CONFLICT (staff_id, work_date) DO UPDATE
        SET regular_hrs                = EXCLUDED.regular_hrs,
            overtime_hrs               = EXCLUDED.overtime_hrs,
            sunday_hrs                 = EXCLUDED.sunday_hrs,
            holiday_hrs                = EXCLUDED.holiday_hrs,
            night_hrs                  = EXCLUDED.night_hrs,
            rule_id                    = EXCLUDED.rule_id,
            computation_mode           = EXCLUDED.computation_mode,
            wage_amount_cents          = EXCLUDED.wage_amount_cents,
            hourly_rate_snapshot_cents = EXCLUDED.hourly_rate_snapshot_cents,
            computed_at                = EXCLUDED.computed_at`,
    params: [
      SAMPLE_UUID,
      SAMPLE_DATE,
      8,
      0,
      0,
      0,
      0,
      SAMPLE_UUID,
      'bcea_default',
      96000,
      12000,
    ],
  },
  {
    name: 'raiseCapViolation',
    text: `
      INSERT INTO attendance_exceptions (entry_id, exception_kind, severity, details)
      VALUES (
        $1::uuid,
        'out_of_hours',
        'critical',
        jsonb_build_object(
          'reason', 'weekly_ot_cap_exceeded',
          'weekly_ot_hrs', $2::numeric,
          'cap_hrs', $3::numeric
        )
      )`,
    params: [SAMPLE_UUID, 15, 10],
  },
  {
    name: 'loadCandidateEntries (Cartrack)',
    text: `
      SELECT
        e.id,
        e.staff_id,
        e.work_date::text AS work_date,
        e.clock_in_at::text,
        e.clock_out_at::text,
        e.clock_in_lat::text,
        e.clock_in_lon::text,
        e.clock_out_lat::text,
        e.clock_out_lon::text,
        fv.cartrack_vehicle_id,
        EXISTS (
          SELECT 1 FROM attendance_gps_verifications v
          WHERE v.entry_id = e.id AND v.check_type = 'in'
        ) AS has_in_verification,
        EXISTS (
          SELECT 1 FROM attendance_gps_verifications v
          WHERE v.entry_id = e.id AND v.check_type = 'out'
        ) AS has_out_verification
      FROM attendance_entries e
      JOIN vehicle_assignments va ON va.id = e.vehicle_assignment_id
      JOIN fleet_vehicles fv ON fv.id = va.fleet_vehicle_id
      WHERE e.status IN ('closed', 'auto_closed', 'manual')
        AND e.vehicle_assignment_id IS NOT NULL
        AND e.work_date >= $1::date
        AND e.work_date <= $2::date
      ORDER BY e.clock_in_at ASC`,
    params: [SAMPLE_DATE, SAMPLE_DATE],
  },
  {
    name: 'upsertVerification (Cartrack)',
    text: `
      INSERT INTO attendance_gps_verifications (
        entry_id, check_type, verdict,
        vehicle_cartrack_id, vehicle_lat, vehicle_lon, vehicle_ts,
        device_lat, device_lon, distance_m, threshold_m,
        reconciled_at
      ) VALUES (
        $1, $2, $3,
        $4,
        $5, $6,
        $7,
        $8, $9,
        $10, $11,
        NOW()
      )
      ON CONFLICT (entry_id, check_type) DO NOTHING
      RETURNING id`,
    params: [
      SAMPLE_UUID,
      'in',
      'match',
      '123',
      -26.2,
      28.0,
      SAMPLE_TIMESTAMPTZ,
      -26.2,
      28.0,
      10.5,
      500,
    ],
  },
  {
    name: 'upsertMismatchAtomic — verification INSERT',
    text: `
      INSERT INTO attendance_gps_verifications (
        entry_id, check_type, verdict,
        vehicle_cartrack_id, vehicle_lat, vehicle_lon, vehicle_ts,
        device_lat, device_lon, distance_m, threshold_m,
        reconciled_at
      ) VALUES (
        $1, $2, 'mismatch',
        $3, $4, $5, $6::timestamptz,
        $7, $8, $9, $10,
        NOW()
      )
      ON CONFLICT (entry_id, check_type) DO NOTHING
      RETURNING id`,
    params: [
      SAMPLE_UUID,
      'in',
      '123',
      -26.2,
      28.0,
      SAMPLE_TIMESTAMPTZ,
      -26.2,
      28.0,
      5000.0,
      500,
    ],
  },
  {
    name: 'upsertMismatchAtomic — exception INSERT',
    text: `
      INSERT INTO attendance_exceptions (entry_id, exception_kind, severity, details)
      VALUES (
        $1::uuid,
        'vehicle_gps_mismatch',
        'info',
        jsonb_build_object(
          'distance_m', $2::numeric,
          'threshold_m', $3::numeric,
          'check_type', $4::text,
          'note', 'Cartrack vehicle position differs from device GPS. Corroboration only — not fraud.'
        )
      )
      ON CONFLICT (entry_id)
        WHERE exception_kind = 'vehicle_gps_mismatch' AND resolved_at IS NULL
        DO NOTHING
      RETURNING id`,
    params: [SAMPLE_UUID, 5000.0, 500, 'in'],
  },
  {
    name: 'attendance-export weekly SELECT (summaries + exceptions + bounds CTEs)',
    text: `
      WITH week_exceptions AS (
        SELECT xe.staff_id, xe.work_date, COUNT(*)::int AS exceptions_count
        FROM attendance_exceptions x
        JOIN attendance_entries xe ON xe.id = x.entry_id
        WHERE xe.work_date >= $1::date
          AND xe.work_date <= $2::date
          AND x.resolved_at IS NULL
        GROUP BY xe.staff_id, xe.work_date
      ),
      week_entry_bounds AS (
        SELECT staff_id, work_date,
               MIN(clock_in_at)  AS first_clock_in_at,
               MAX(clock_out_at) AS last_clock_out_at
        FROM attendance_entries
        WHERE work_date >= $1::date
          AND work_date <= $2::date
        GROUP BY staff_id, work_date
      )
      SELECT
        ds.staff_id,
        s.employee_id,
        TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS full_name,
        ds.work_date::text AS work_date,
        web.first_clock_in_at::text  AS clock_in_at,
        web.last_clock_out_at::text  AS clock_out_at,
        ds.regular_hrs::text,
        ds.overtime_hrs::text,
        ds.sunday_hrs::text,
        ds.holiday_hrs::text,
        ds.night_hrs::text,
        ds.wage_amount_cents::text,
        ds.hourly_rate_snapshot_cents::text,
        COALESCE(wx.exceptions_count, 0) AS exceptions_count
      FROM attendance_daily_summaries ds
      JOIN staff s ON s.id = ds.staff_id
      LEFT JOIN week_entry_bounds web
        ON web.staff_id = ds.staff_id AND web.work_date = ds.work_date
      LEFT JOIN week_exceptions wx
        ON wx.staff_id = ds.staff_id AND wx.work_date = ds.work_date
      WHERE ds.work_date >= $1::date
        AND ds.work_date <= $2::date
      ORDER BY full_name ASC, ds.work_date ASC`,
    params: [SAMPLE_DATE, SAMPLE_DATE],
  },
  {
    name: 'staffIdsSupervisedBy (inverse CTE)',
    text: `
      WITH RECURSIVE descendants AS (
        SELECT id, 1 AS depth
        FROM staff
        WHERE reports_to = $1::uuid

        UNION ALL

        SELECT s.id, d.depth + 1
        FROM staff s
        JOIN descendants d ON s.reports_to = d.id
        WHERE d.depth < $2::int
      ),
      viewer AS (
        SELECT id, department
        FROM staff
        WHERE id = $1::uuid
      ),
      viewer_has_reports AS (
        SELECT EXISTS (
          SELECT 1 FROM staff WHERE reports_to = $1::uuid
        ) AS yes
      )
      SELECT id FROM viewer
      UNION
      SELECT id FROM descendants
      UNION
      SELECT s.id
      FROM staff s, viewer v, viewer_has_reports vhr
      WHERE vhr.yes
        AND v.department IS NOT NULL
        AND s.department IS NOT NULL
        AND s.department = v.department`,
    params: [SAMPLE_UUID, 10],
  },
  {
    name: 'listAdjustmentsForReview — scoped-to-staff branch (any(uuid[]) filter)',
    text: `
      SELECT a.*,
             e.staff_id   AS entry_staff_id,
             e.work_date::text AS entry_work_date,
             e.clock_in_at::text  AS entry_clock_in_at,
             e.clock_out_at::text AS entry_clock_out_at,
             TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS staff_full_name
      FROM attendance_adjustments a
      JOIN attendance_entries e ON e.id = a.entry_id
      JOIN staff s ON s.id = e.staff_id
      WHERE a.status = $1::text
        AND e.staff_id = ANY($2::uuid[])
      ORDER BY a.created_at DESC
      LIMIT $3::int`,
    params: ['pending', [SAMPLE_UUID], 50],
  },
  {
    name: 'canSuperviseStaff (recursive CTE + department fallback)',
    text: `
      WITH RECURSIVE ancestors AS (
        SELECT reports_to AS ancestor_id, 1 AS depth
        FROM staff
        WHERE id = $1::uuid

        UNION ALL

        SELECT s.reports_to, a.depth + 1
        FROM staff s
        JOIN ancestors a ON s.id = a.ancestor_id
        WHERE a.ancestor_id IS NOT NULL
          AND a.depth < $3::int
      )
      SELECT (
        EXISTS (
          SELECT 1 FROM ancestors WHERE ancestor_id = $2::uuid
        )
        OR EXISTS (
          SELECT 1
          FROM staff v, staff t
          WHERE v.id = $2::uuid
            AND t.id = $1::uuid
            AND v.department IS NOT NULL
            AND t.department IS NOT NULL
            AND v.department = t.department
            AND EXISTS (
              SELECT 1 FROM staff r WHERE r.reports_to = v.id
            )
        )
      ) AS allowed`,
    params: [SAMPLE_UUID, SAMPLE_UUID, 10],
  },
];

describe.skipIf(!INTEGRATION_ENABLED)(
  'attendance reconcile SQL — live-DB EXPLAIN suite',
  () => {
    let pool: Pool;

    beforeAll(() => {
      const url = process.env.SUPABASE_INTEGRATION_DB_URL;
      if (!url) {
        throw new Error(
          'SUPABASE_INTEGRATION_TEST=true but SUPABASE_INTEGRATION_DB_URL is not set'
        );
      }
      pool = new Pool({ connectionString: url });
    });

    afterAll(async () => {
      await pool?.end();
    });

    for (const tmpl of TEMPLATES) {
      it(`EXPLAIN ${tmpl.name} parses against the live schema`, async () => {
        // EXPLAIN without ANALYZE parses + plans without executing.
        // Any missing column or table surfaces as a syntax/relation error.
        await expect(
          pool.query(`EXPLAIN (VERBOSE) ${tmpl.text}`, tmpl.params)
        ).resolves.toBeDefined();
      });
    }
  }
);

describe.skipIf(INTEGRATION_ENABLED)(
  'attendance reconcile SQL — integration suite is gated',
  () => {
    it('skips when SUPABASE_INTEGRATION_TEST is not "true"', () => {
      expect(INTEGRATION_ENABLED).toBe(false);
    });
  }
);
