-- Rollback for 477_conformed_project_dimension.sql
-- Re-runnable: guarded, and clears its own schema_migrations row (that table is
-- keyed on `filename`, not `version`).
--
-- Safe to run: nothing depends on this function yet. Once a metric definition or an
-- index uses canonical_project(), DROP will fail on the dependency rather than
-- silently breaking it — which is the desired behaviour, so no CASCADE here.

DROP FUNCTION IF EXISTS canonical_project(text);

DELETE FROM schema_migrations WHERE filename = '477_conformed_project_dimension.sql';
