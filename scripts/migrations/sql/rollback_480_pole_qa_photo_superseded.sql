-- Rollback for 480_pole_qa_photo_superseded.sql
-- Re-runnable: every statement guarded, and clears its own schema_migrations row
-- (that table is keyed on `filename`, not `version`).
--
-- ⚠️ This DISCARDS the marks, not the photos. The pole_qa_photos rows themselves are
-- untouched by both the forward migration and this one — no QA work is lost either
-- way. What is lost is the record of WHICH photos a replan could not place, which on
-- Thembisa POP 3 is the only thing distinguishing 34 unplaceable photos (5 of them
-- carrying a real photo key) from photos whose zone merely has not synced yet.
--
-- Check what you are discarding first:
--   SELECT project_id, superseded_reason, count(*)
--     FROM public.pole_qa_photos
--    WHERE superseded_at IS NOT NULL
--    GROUP BY 1, 2;
--
-- The index goes before the columns so a re-run after a partial failure cannot trip
-- over an index on a column that is already gone.

DROP INDEX IF EXISTS public.pole_qa_photos_superseded_idx;

ALTER TABLE public.pole_qa_photos
    DROP COLUMN IF EXISTS superseded_reason,
    DROP COLUMN IF EXISTS superseded_run_id,
    DROP COLUMN IF EXISTS superseded_at;

-- Guarded with IF EXISTS on the TABLE too: rolling 479 back first removes this table
-- entirely, and this file must stay re-runnable in either order.
ALTER TABLE IF EXISTS public.pole_qa_photo_plan_backup
    DROP COLUMN IF EXISTS superseded_reason,
    DROP COLUMN IF EXISTS superseded_run_id,
    DROP COLUMN IF EXISTS superseded_at;

DELETE FROM schema_migrations WHERE filename = '480_pole_qa_photo_superseded.sql';
