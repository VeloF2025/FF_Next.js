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
-- `checksum` is absent for the same reason, and it is the least obvious of the
-- three. The digest is taken over a fixed field order that includes
-- `contributor_count`, `sample_count`, `sum_seconds` and the bucket counts —
-- and every OTHER field in that preimage is published. `canonicalize` is in the
-- repository. So a reader with the view holds all but one unknown of a sha256
-- preimage, and a contributor count is a small integer: a few thousand hashes
-- recovers it exactly, for every row, and `sum_seconds` for timing rows besides.
-- Removing three columns and publishing a fourth that reconstructs them is the
-- kind of thing a column list has to be read as a whole to catch. The writer
-- compares checksums against the BASE table, which is where the column lives.
--
-- `generalized_from_level` is likewise absent. Under the tier rule it carries no
-- information. No site row is written, so a project row is always generalized
-- from site; and the organisation publishes only over projects that are all-in
-- or all-out, so the column would say the same thing on every organisation row
-- of a given tier. A column whose value is a function of its level tells a
-- reader nothing and is not published.
--
-- DROP then CREATE, rather than CREATE OR REPLACE. Postgres will not let a
-- replacement DROP a column from an existing view — "cannot drop columns from
-- view" — and this column list has narrowed twice under review already. A
-- migration that only applies to a database which has never seen an earlier
-- version of it is not repeatable, and re-runnability is the property the
-- runner relies on. Nothing depends on the view, so dropping it costs nothing;
-- the GRANT below is reissued because DROP takes the privilege with it.
--
-- Verified 2026-08-24: neither the view nor this migration exists in the shared
-- database yet, so no deployed reader is disturbed by the drop.

DROP VIEW IF EXISTS fleet_operational_monthly_aggregates_published;

CREATE VIEW fleet_operational_monthly_aggregates_published
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
  created_at,
  updated_at
FROM fleet_operational_monthly_aggregates
WHERE is_active = true
  AND dimension_level IN ('organisation', 'project');

COMMENT ON VIEW fleet_operational_monthly_aggregates_published IS
  'The only relation a read path may use for PR8 operational aggregates. Organisation and project rows only, with no contributor_count and no histogram columns. See .claude/modules/fleet-analytics-disclosure.md.';

GRANT SELECT ON fleet_operational_monthly_aggregates_published TO fibreflow_user;
