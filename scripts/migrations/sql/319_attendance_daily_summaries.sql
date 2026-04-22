-- Migration 319: attendance_daily_summaries (Phase 1b — overtime engine)
--
-- One row per (staff_id, work_date). Populated by the nightly reconcile cron
-- from closed attendance_entries. The hour buckets are accounting categories
-- computed by src/services/attendance/overtimeCalculator.ts (pure function).
--
-- Bucket semantics (matters for audit and payroll export):
--   regular_hrs   — ordinary-rate hours (up to daily_ordinary_hrs from rule)
--   overtime_hrs  — hours above daily_ordinary_hrs on a weekday (paid at ot_multiplier)
--   sunday_hrs    — total hours worked on Sunday (paid at sunday_*_multiplier;
--                   these hours are ALSO reflected in regular_hrs/overtime_hrs so
--                   the sum of buckets > hours worked. This is intentional: the
--                   export presents all four so the payroll vendor can pick the
--                   multiplier it owes separately.)
--   holiday_hrs   — total hours worked on a public holiday (same dual-count as Sunday)
--   night_hrs     — hours inside [night_start, night_end] from the rule; pays a
--                   10% allowance on top of whatever rate applied (BCEA s17).
--
-- wage_amount_cents is NULL until rate-capture lands; the calculator returns
-- hours only. Phase 1c will wire staff hourly rates and backfill this column.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS attendance_daily_summaries (
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,

    -- Upper bounds are physically plausible ceilings; a single day cannot
    -- exceed 24h worked, and BCEA s10 caps OT at 10h/week (15h/day is a
    -- generous statutory ceiling for a single day to accommodate back-to-back
    -- shifts that still get flagged by the cron).
    regular_hrs  NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (regular_hrs  >= 0 AND regular_hrs  <= 24),
    overtime_hrs NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (overtime_hrs >= 0 AND overtime_hrs <= 15),
    sunday_hrs   NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (sunday_hrs   >= 0 AND sunday_hrs   <= 24),
    holiday_hrs  NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (holiday_hrs  >= 0 AND holiday_hrs  <= 24),
    night_hrs    NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (night_hrs    >= 0 AND night_hrs    <= 24),

    -- regular + overtime together represent the hours actually worked
    -- (sunday/holiday dual-count, night overlaps). They cannot exceed a day.
    CONSTRAINT attendance_daily_summaries_regular_plus_ot_le_24
      CHECK (regular_hrs + overtime_hrs <= 24),

    wage_amount_cents BIGINT CHECK (wage_amount_cents IS NULL OR wage_amount_cents >= 0),

    rule_id UUID NOT NULL REFERENCES attendance_overtime_rules(id) ON DELETE RESTRICT,

    -- Set to 'exempt' when staff.bcea_applicable = false so the calculator
    -- computed ordinary hours only (BCEA s6). Kept as text rather than bool
    -- so future rule profiles (collective-agreement OT, averaging) can grow
    -- without another schema change.
    computation_mode VARCHAR(24) NOT NULL DEFAULT 'bcea_default'
      CHECK (computation_mode IN ('bcea_default', 'bcea_exempt', 'collective_agreement')),

    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (staff_id, work_date)
);

-- Weekly export range queries ("all summaries for week starting YYYY-MM-DD")
CREATE INDEX IF NOT EXISTS idx_attendance_daily_summaries_work_date
  ON attendance_daily_summaries(work_date);

-- Per-staff weekly view drill-down
CREATE INDEX IF NOT EXISTS idx_attendance_daily_summaries_staff_work_date
  ON attendance_daily_summaries(staff_id, work_date DESC);

-- Reconcile cron recomputes summaries newer than its last run
CREATE INDEX IF NOT EXISTS idx_attendance_daily_summaries_computed_at
  ON attendance_daily_summaries(computed_at DESC);

-- ---------------------------------------------------------------------------
-- GRANTs for the runtime app user
-- ---------------------------------------------------------------------------
-- Migrations run as superuser `postgres`. The app runs as `fibreflow_user`,
-- which needs explicit CRUD on every new object. Missing this step is a
-- common footgun post-Supabase cutover (see migration 310 for context).

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON attendance_daily_summaries TO fibreflow_user;

-- ---------------------------------------------------------------------------
-- COMMENTs so pg_dump / IDE introspection picks up the dual-reporting
-- convention without having to read this migration file.
-- ---------------------------------------------------------------------------

COMMENT ON TABLE attendance_daily_summaries IS
  'One row per (staff_id, work_date) with BCEA hour buckets. sunday_hrs and '
  'holiday_hrs OVERLAP with regular_hrs/overtime_hrs — the sum of all buckets '
  'can exceed hours actually worked. Payroll vendors pick multipliers from '
  'the appropriate bucket; see scripts/migrations/sql/319_attendance_daily_summaries.sql.';

COMMENT ON COLUMN attendance_daily_summaries.sunday_hrs IS
  'Total hours on a Sunday (BCEA s16); dual-counted with regular_hrs/overtime_hrs.';
COMMENT ON COLUMN attendance_daily_summaries.holiday_hrs IS
  'Total hours on a public holiday (BCEA s18); dual-counted with regular_hrs/overtime_hrs.';
COMMENT ON COLUMN attendance_daily_summaries.night_hrs IS
  'Hours inside rule''s [night_start, night_end] (BCEA s17); overlaps regular/OT.';
COMMENT ON COLUMN attendance_daily_summaries.wage_amount_cents IS
  'NULL until rate-capture lands (Phase 1c). Calculator returns hours only today.';

-- ---------------------------------------------------------------------------
-- Verify (uncomment to run after applying)
-- ---------------------------------------------------------------------------
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'attendance_daily_summaries' ORDER BY ordinal_position;
-- SELECT indexname FROM pg_indexes
--   WHERE tablename = 'attendance_daily_summaries' ORDER BY indexname;
