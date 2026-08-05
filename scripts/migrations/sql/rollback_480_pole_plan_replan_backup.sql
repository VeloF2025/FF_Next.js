-- Rollback for 480_pole_plan_replan_backup.sql
-- Re-runnable: every statement guarded, and clears its own schema_migrations row
-- (that table is keyed on `filename`, not `version`).
--
-- ⚠️ ORDER OF OPERATIONS: this drops the SAFETY NET, not an import. If a replan
-- import has already run against a project, its pre-import snapshot lives in
-- these tables and is the ONLY way back to the previous plan. Run
-- `import_replan_poles.py --rollback <run_id>` for every run still in status
-- 'completed' BEFORE dropping, or the old plan is gone for good.
--
-- Check first:
--   SELECT id, project_id, status, started_at
--     FROM public.pole_plan_import_runs
--    WHERE status = 'completed';
--
-- The two backup tables are dropped before the runs table they reference, so no
-- CASCADE is needed and an unexpected extra dependant raises an error rather
-- than being silently swept away.

DROP TABLE IF EXISTS public.pole_qa_photo_plan_backup;
DROP TABLE IF EXISTS public.pole_plan_backup;
DROP TABLE IF EXISTS public.pole_plan_import_runs;

DELETE FROM schema_migrations WHERE filename = '480_pole_plan_replan_backup.sql';
