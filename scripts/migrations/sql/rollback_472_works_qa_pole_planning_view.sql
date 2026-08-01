-- Rollback: 472_works_qa_pole_planning_view.sql
--
-- Re-runnable. DROP ... IF EXISTS matches nothing on a second run rather than
-- aborting, and the schema_migrations delete is unconditional.
--
-- ⚠️ Dropping this view breaks any caller still referencing it. Deploy order
-- matters: roll the application back to a build that reads `sow_poles`
-- directly BEFORE running this, otherwise works-qa/zones.ts,
-- works-qa/sync-historical.ts and syncQfieldCore.ts all fail with
-- "relation v_pole_planning does not exist" — a 500 on the Works QA page and
-- on every QField sync.
--
-- ⚠️ RESTRICT (the default) is deliberate: if something else has come to depend
-- on this view since 472 was applied, this rollback should fail loudly rather
-- than silently cascade the dependant away. If it does fail, find the dependant
-- with:
--   SELECT dependent_ns.nspname, dependent_view.relname
--     FROM pg_depend d
--     JOIN pg_rewrite r         ON r.oid = d.objid
--     JOIN pg_class dependent_view ON dependent_view.oid = r.ev_class
--     JOIN pg_class source_table   ON source_table.oid = d.refobjid
--     JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent_view.relnamespace
--    WHERE source_table.relname = 'v_pole_planning'
--      AND dependent_view.relname <> 'v_pole_planning';
--
-- No data is lost: 472 created a view only. sow_poles and public.poles are
-- untouched by both the forward migration and this rollback.

DROP VIEW IF EXISTS public.v_pole_planning;

DELETE FROM schema_migrations
 WHERE filename = '472_works_qa_pole_planning_view.sql';
