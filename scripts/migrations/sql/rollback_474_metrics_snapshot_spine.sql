-- Rollback for 474_metrics_snapshot_spine.sql
-- Re-runnable: every statement is guarded, and it clears its own schema_migrations
-- row (that table is keyed on `filename`, not `version`).
--
-- WARNING: this destroys accumulated point-in-time history, which cannot be
-- reconstructed — the upstream sources overwrite rather than retain. Only roll back
-- if the spine is being abandoned, not to "reset" it.

DROP INDEX IF EXISTS snapshot_runs_source_date_key;
DROP TABLE IF EXISTS snapshot_runs;

DROP INDEX IF EXISTS metric_snapshots_dims_gin;
DROP INDEX IF EXISTS metric_snapshots_source_date_idx;
DROP INDEX IF EXISTS metric_snapshots_source_date_entity_key;
DROP TABLE IF EXISTS metric_snapshots;

DELETE FROM schema_migrations WHERE filename = '474_metrics_snapshot_spine.sql';
