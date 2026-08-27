-- 530_fleet_aggregate_month_coverage.sql
--
-- Records, explicitly, that a month was aggregated — so retention's deletion
-- gate stops inferring it from the presence of aggregate rows.
--
-- THE BUG THIS CLOSES
--
-- `hasCompleteAggregateCoverage` asked whether any published row exists for a
-- (month, metric_version) and read a non-zero count as proof the month had been
-- aggregated. That inference is wrong in one direction, and it is the direction
-- that matters.
--
-- A month can be aggregated FULLY and CORRECTLY and store nothing at all. The
-- release rule withholds a metric whose support is empty rather than publishing
-- a roster-sized zero — see `anonymitySetFor` and the disclosure note — so a
-- month in which nothing qualifying happened, or in which every group fell
-- below the anonymity threshold, produces zero rows. Under the old gate that
-- month reports NO coverage, forever, and its identifiable detail is never
-- purged. The retention policy silently does not apply to exactly the quietest
-- months.
--
-- Failing closed is the right direction for a gate that authorises deletion,
-- which is why this was a latent defect rather than a leak. But a retention
-- path that cannot retain is not a working retention path, and the fix is to
-- record the fact directly instead of guessing it from a side effect.
--
-- WHY A ROW HERE MEANS WHAT IT SAYS
--
-- The writer inserts into this table inside `replaceMonth`'s transaction — the
-- same transaction that deletes the old generation and writes the new one. So
-- coverage and the rows it attests to commit together or not at all. A separate
-- write after the fact could succeed while the rows failed, which would be a
-- gate asserting coverage for a month that has none: the one failure mode worth
-- designing against, because its consequence is deletion.
--
-- It is upserted, not inserted. The nightly job re-aggregates every month in
-- the recalculation window, so the same (metric_version, month_start) is
-- written repeatedly and a plain INSERT would fail on the second night.
-- `aggregation_run_id` and `completed_at` therefore name the LATEST run that
-- covered the month, not the first.
--
-- A month whose aggregation FAILS never reaches `replaceMonth` — the service
-- throws before it — so its previous coverage row simply stays as it was. That
-- is correct and deliberate: a failed recomputation leaves the previous
-- generation active, and the coverage that describes it is still true.
--
-- WHY IT IS KEYED ON metric_version
--
-- Coverage is a claim about a month UNDER A DEFINITION. Changing the metric
-- version means the stored numbers answer a different question, and a month
-- covered under version 1 is not covered under version 2 until it has been
-- recomputed. Keying on the pair makes the gate fail closed across a version
-- bump without anyone having to remember to clear anything.
--
-- NOT AN AGGREGATE, AND NOT DISCLOSIVE
--
-- Every column here is operational metadata about a JOB: which month, which
-- definition, which run, when, and how many rows it wrote. `row_count` is the
-- size of a published set that is itself readable, so it reveals nothing the
-- published view does not already. No column can hold a person, a site, a
-- coordinate or a measurement, and this table is deliberately NOT part of the
-- published aggregate surface — it is not exposed through any read path.

CREATE TABLE IF NOT EXISTS fleet_operational_aggregate_month_coverage (
  metric_version     integer     NOT NULL,
  -- Always the first day of the month, in SAST terms, matching every other
  -- month_start in this module. The CHECK makes that structural rather than a
  -- convention a future writer could miss.
  month_start        date        NOT NULL,
  aggregation_run_id uuid        NOT NULL REFERENCES fleet_operational_aggregation_runs(id),
  row_count          integer     NOT NULL,
  completed_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fleet_aggregate_coverage_pk PRIMARY KEY (metric_version, month_start),
  CONSTRAINT fleet_aggregate_coverage_month_is_first
    CHECK (month_start = date_trunc('month', month_start)::date),
  CONSTRAINT fleet_aggregate_coverage_rows_nonnegative
    CHECK (row_count >= 0)
);

COMMENT ON TABLE fleet_operational_aggregate_month_coverage IS
  'One row per (metric_version, month_start) successfully aggregated. Retention''s deletion gate reads this instead of counting aggregate rows: a correctly aggregated month can legitimately publish zero rows, and counting rows made those months unpurgeable forever.';

COMMENT ON COLUMN fleet_operational_aggregate_month_coverage.row_count IS
  'Rows the covering run wrote for this month. Zero is a valid, complete answer — not an absence of coverage.';

GRANT SELECT, INSERT, UPDATE, DELETE ON fleet_operational_aggregate_month_coverage TO fibreflow_user;
