-- Migration 474: Metrics snapshot spine
--
-- Purpose: generic point-in-time snapshot store for the metrics platform.
-- Generalises the offline_devices pattern (925k rows across 119 nightly
-- report_date values) so adding a new snapshot source needs no migration —
-- dimensions and measures are JSONB, keyed by (source_key, as_of_date, entity_id).
--
-- Why this exists at all: oes_activations is UNIQUE on drop_number and the nightly
-- OES import upserts, so row-level history is destroyed. Point-in-time state can
-- only be captured going forward, which is why this ships ahead of the registry
-- that will read it.
--
-- NOTE: no BEGIN/COMMIT — the migration runner manages the transaction.
--
-- NLNH confidence: HIGH — table shapes verified against the live schema 2026-08-01.

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id           BIGSERIAL PRIMARY KEY,
  source_key   TEXT        NOT NULL,
  as_of_date   DATE        NOT NULL,
  entity_id    TEXT        NOT NULL,
  dims         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  measures     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Also the integrity guard: a source whose entity_id is not unique raises here and
-- aborts the write, rather than silently undercounting a day marked complete.
CREATE UNIQUE INDEX IF NOT EXISTS metric_snapshots_source_date_entity_key
  ON metric_snapshots (source_key, as_of_date, entity_id);

CREATE INDEX IF NOT EXISTS metric_snapshots_source_date_idx
  ON metric_snapshots (source_key, as_of_date DESC);

CREATE INDEX IF NOT EXISTS metric_snapshots_dims_gin
  ON metric_snapshots USING GIN (dims);

COMMENT ON TABLE metric_snapshots IS
  'Append-only point-in-time snapshots. One row per (source, day, entity). Never updated in place.';

-- Completion LOG — deliberately not a lock.
--
-- "Has this day been written?" cannot be answered by count(*) > 0 on
-- metric_snapshots, because that cannot distinguish COMPLETE from PARTIAL, so a
-- half-written day would be skipped forever and silently under-report. This table
-- answers it: a day is written iff a row exists here.
--
-- Mutual exclusion is a transaction-scoped advisory lock in the writer, NOT a claim
-- row here. Do not add a status column and reintroduce a state machine: an earlier
-- design did, and it produced unbounded lock waiting, an unreclaimable 'running'
-- state, and a stale failure marker able to overwrite a later success.
CREATE TABLE IF NOT EXISTS snapshot_runs (
  id           BIGSERIAL PRIMARY KEY,
  source_key   TEXT        NOT NULL,
  as_of_date   DATE        NOT NULL,
  row_count    INTEGER     NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS snapshot_runs_source_date_key
  ON snapshot_runs (source_key, as_of_date);

COMMENT ON TABLE snapshot_runs IS
  'Completion log. A (source, day) is written iff a row exists here. Mutual exclusion is an advisory lock in the writer, not this table.';
