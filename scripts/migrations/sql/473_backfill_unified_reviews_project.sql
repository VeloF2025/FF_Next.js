-- Migration 473: backfill dr_photo_unified_reviews.project from `drops`.
--
-- Data-only and idempotent: fills a NULL column with the value `drops` already
-- holds. Re-running matches nothing (the `project IS NULL` guard no longer
-- holds) rather than erroring. Touches no schema object.
--
-- NOT wrapped in BEGIN;/COMMIT; on purpose. scripts/run-pending-migrations.sh
-- applies this file as `psql -1 -c "\i <file>" -c "INSERT INTO
-- schema_migrations ..."`. Postgres does not nest transactions, so a COMMIT
-- inside the file ends psql's transaction early and lets the change commit
-- while its tracker row fails independently. Matches 467, 469, 471 and 472.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- `pages/api/activate/ensure-data.ts` (called when the QA wizard opens a DR
-- that has no unified row yet) inserted a skeleton row of drop_number +
-- timestamps only. `fetchAndUpdateFromOneMap` then set photo_source='onemap'
-- but never filled `project`. Every other writer sets it —
-- oesUnifiedRecordsService resolves it from `drops` explicitly, calling that
-- table "source of truth".
--
-- The Activate per-project table groups on COALESCE(project, 'Unknown'), so
-- each of these rows surfaced under a literal "Unknown" project — which is
-- itself in the query's EXCLUDED_PROJECTS list, making the row read as a bug.
--
-- Measured on the live database 2026-08-01, before this migration:
--   26,121 rows total
--       37 with project IS NULL
--       11 of those resolvable via drops -> projects  (the rest are not in
--          `drops` at all, so the stats queries already exclude them via
--          `drop_number IN (SELECT drop_number FROM drops)`)
--
-- The 11: DR470538, DR471952, DR473569, DR469028, DR469034 (Mamelodi);
-- DR2377456, DR2377447, DR2377704, DR2377839 (Etwatwa);
-- DR2601062, DR2600703 (Thembisa POP 1). Spread from 2026-02-16 to 2026-08-01.
--
-- The insert path itself is fixed in the same PR, so this is a one-off
-- correction of rows already created, not a recurring sweep.
--
-- ── Scope guards ───────────────────────────────────────────────────────────
-- * `project IS NULL` — never overwrites a project someone already set. This
--   migration can only turn NULL into a value, never change one value to
--   another.
-- * Correlated scalar subquery + LIMIT 1 rather than UPDATE ... FROM: `drops`
--   is UNIQUE on (project_id, drop_number), NOT on drop_number alone, so a
--   join form could legally match more than one row and pick arbitrarily.
-- * `submitted_date` is deliberately NOT backfilled. These rows genuinely were
--   never submitted via WhatsApp, so NULL is the correct value; the stats
--   queries handle it via COALESCE(submitted_date, created_at::DATE) (PR #2345).

-- ORDER BY makes the pick deterministic rather than merely single-valued, so
-- this migration and the ensure-data.ts insert resolve the same drop to the
-- same project if a drop_number ever does span two project_ids. `projects.
-- project_name` is schema-enforced NOT NULL, so the subquery cannot write NULL
-- into a row the EXISTS guard just matched.
UPDATE dr_photo_unified_reviews u
   SET project = (
         SELECT p.project_name
           FROM drops d
           JOIN projects p ON p.id = d.project_id
          WHERE d.drop_number = u.drop_number
          ORDER BY p.project_name
          LIMIT 1
       ),
       updated_at = NOW()
 WHERE u.project IS NULL
   AND EXISTS (
         SELECT 1
           FROM drops d
           JOIN projects p ON p.id = d.project_id
          WHERE d.drop_number = u.drop_number
       );
