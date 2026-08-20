-- 504: H&S check-in gains an explicit work location.
--
-- The check-in is moving inside the clock-in, where every worker passes
-- through — including office staff, who have no project. `work_location` is
-- what the worker declares; `project_id` stays required for a site
-- declaration and becomes NULL for an office one.
--
-- Existing rows are all site declarations: every one of them carries a
-- project, which was NOT NULL until this migration.
--
-- checkinCrewWrite.ts's independent INSERT into hs_daily_checkins names its
-- columns explicitly and does not name work_location, so it relies on the
-- DEFAULT 'site' below for its crew rows — the default is intentionally kept,
-- not a one-off backfill convenience.
--
-- The two CHECK constraints below are PROVEN to reject the rows they are
-- meant to reject by scripts/hs-checkin-work-location-proof.sh, which applies
-- this file to a throwaway Postgres and inserts rows that must fail. Nothing
-- runs that script automatically: if these constraints are ever edited, re-run
-- it by hand or their behaviour is unverified.
--
-- Idempotent. Rollback: rollback_504_hs_checkin_work_location.sql.

ALTER TABLE hs_daily_checkins
  ADD COLUMN IF NOT EXISTS work_location text NOT NULL DEFAULT 'site';

ALTER TABLE hs_daily_checkins
  ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE hs_daily_checkins
  DROP CONSTRAINT IF EXISTS hs_daily_checkins_work_location_check;
ALTER TABLE hs_daily_checkins
  ADD CONSTRAINT hs_daily_checkins_work_location_check
  CHECK (work_location IN ('site', 'office'));

-- A site declaration without a project would be unattributable on the officer
-- board, so the old NOT NULL is preserved for exactly that case.
ALTER TABLE hs_daily_checkins
  DROP CONSTRAINT IF EXISTS hs_daily_checkins_site_needs_project;
ALTER TABLE hs_daily_checkins
  ADD CONSTRAINT hs_daily_checkins_site_needs_project
  CHECK (work_location <> 'site' OR project_id IS NOT NULL);
