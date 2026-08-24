-- 527_fleet_aggregates_published_view.sql
--
-- Adds fleet_operational_monthly_aggregates_published: the only relation any
-- read path may use to read PR8 operational aggregates.
--
-- WHY A VIEW AND NOT A CONVENTION
--
-- `fleet_operational_monthly_aggregates` keeps every generation of every month.
-- Superseded rows are marked `is_active = false` and never deleted, and those
-- rows are the DISCLOSIVE ones: `replaceMonth` retires a generation precisely
-- when it is recomputed, and the case that recomputes a month to fewer rows is
-- the anonymity threshold being RAISED. The pre-tightening generation — the one
-- that published groups now judged too small — stays in the table with nothing
-- but a WHERE predicate between it and a reader.
--
-- Until now that predicate was a convention. `hasCompleteAggregateCoverage` in
-- retentionRepository.ts writes `AND is_active = true` correctly, but nothing
-- makes the next query do the same, and the failure is silent: a forgotten
-- predicate returns MORE rows, not an error, and the extra rows are withheld
-- groups. The disclosure note (open item 2) called for a view before any read
-- path shipped. Stage 8 task 7 is that read path, so the view lands first.
--
-- WHAT THIS DOES AND DOES NOT GUARANTEE
--
-- It does not revoke anything. `fibreflow_user` keeps SELECT on the base table,
-- because it must: migration 518 grants the application full DML, and Postgres
-- requires SELECT on any column named in an UPDATE's WHERE clause or RETURNING
-- list — so revoking it would break `replaceMonth`, the legitimate writer, and
-- the retention purge with it. Splitting the writer onto a role of its own is
-- the change that would let the grant be withdrawn; it is an architectural
-- change, not a migration, and is deliberately not attempted here.
--
-- So the enforcement is layered, and worth stating plainly:
--   * this view hard-codes the predicate, so a query that uses it cannot forget;
--   * a CI guard (aggregateViewContract.test.ts) fails the build if any file
--     outside the writer selects the base table by name;
--   * the database itself still permits a direct read, and would not stop one.
-- That last line is the residual risk, and it is the reason the guard test
-- exists rather than being left to review.
--
-- SECURITY BARRIER
--
-- Marked `security_barrier` so a cheap user-supplied predicate cannot be
-- evaluated ahead of `is_active = true` and observe retired rows through, say, a
-- leaky function in a WHERE clause. The planner loses some pushdown for that;
-- on a monthly aggregate table measured in thousands of rows, that trade is not
-- close.
--
-- IDEMPOTENCY
--
-- CREATE OR REPLACE VIEW is repeatable. It fails loudly rather than silently if
-- the column list ever diverges from an existing view's, which is the desired
-- behaviour: a column added to the base table must be added here consciously.
-- GRANT is likewise a no-op when the privilege is already held.

CREATE OR REPLACE VIEW fleet_operational_monthly_aggregates_published
WITH (security_barrier = true) AS
SELECT
  id,
  metric_version,
  month_start,
  dimension_level,
  dimension_project_id,
  dimension_site_id,
  generalized_from_level,
  metric_key,
  metric_kind,
  numerator,
  denominator,
  sample_count,
  sum_seconds,
  bucket_0_300,
  bucket_301_900,
  bucket_901_1800,
  bucket_1801_3600,
  bucket_3601_14400,
  bucket_over_14400,
  contributor_count,
  is_active,
  aggregation_run_id,
  checksum,
  created_at,
  updated_at
FROM fleet_operational_monthly_aggregates
WHERE is_active = true;

COMMENT ON VIEW fleet_operational_monthly_aggregates_published IS
  'The only relation a read path may use for PR8 operational aggregates. Hard-codes is_active = true so a superseded, pre-tightening generation cannot be read by a query that forgot the predicate. See .claude/modules/fleet-analytics-disclosure.md.';

GRANT SELECT ON fleet_operational_monthly_aggregates_published TO fibreflow_user;
