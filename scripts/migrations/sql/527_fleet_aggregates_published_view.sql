-- 527_fleet_aggregates_published_view.sql
--
-- Adds fleet_operational_monthly_aggregates_published: the only relation any
-- read path may use to read PR8 operational aggregates.
--
-- WHAT THIS VIEW IS FOR
--
-- Three things, and the third is the one worth reading twice.
--
-- 1. `is_active = true` is hard-coded. The base table keeps every generation of
--    every month; superseded rows are marked inactive and never deleted, and
--    those rows are the DISCLOSIVE ones — a month is recomputed to fewer rows
--    exactly when the anonymity threshold is RAISED, so the retired generation
--    is the one that published groups now judged too small. A query that forgets
--    the predicate does not fail; it returns MORE rows, and the extra rows are
--    the withheld groups.
--
-- 2. SITE ROWS ARE NOT PUBLISHED. The release rule decides at organisation and
--    project level and stores site rows for nothing but the roll-up. A site is
--    the smallest group there is and the one an outsider can most easily put a
--    name to.
--
-- 3. `contributor_count` AND EVERY HISTOGRAM COLUMN ARE GONE. Both were
--    channels, not metadata. `contributor_count` differences across metric keys
--    the way numerators do — `cc(scheduled) - cc(confirmed) = 1` names a single
--    person as surely as any numerator would — and `sum_seconds` with a
--    `sample_count` of one IS one person's exact duration. Columns that can
--    leak are removed here rather than reasoned about downstream. The base table
--    keeps them: the writer needs `contributor_count` for its own CHECK, and the
--    histogram is what makes a median estimable after the underlying incident
--    has been purged. Neither is anybody's to read.
--
-- `generalized_from_level` is likewise absent. Under the tier rule it carries no
-- information: sites are never published, so a project row is always generalized
-- from site, and the organisation takes the minimum tier over its projects, so
-- an organisation row is never generalized from project. A column whose value is
-- a function of its level tells a reader nothing and is not published.
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
  metric_key,
  metric_kind,
  numerator,
  denominator,
  is_active,
  aggregation_run_id,
  checksum,
  created_at,
  updated_at
FROM fleet_operational_monthly_aggregates
WHERE is_active = true
  AND dimension_level IN ('organisation', 'project');

COMMENT ON VIEW fleet_operational_monthly_aggregates_published IS
  'The only relation a read path may use for PR8 operational aggregates. Organisation and project rows only, with no contributor_count and no histogram columns. See .claude/modules/fleet-analytics-disclosure.md.';

GRANT SELECT ON fleet_operational_monthly_aggregates_published TO fibreflow_user;
