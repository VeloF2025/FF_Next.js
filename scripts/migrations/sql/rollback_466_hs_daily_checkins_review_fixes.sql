-- Rollback 466: hs_daily_checkins hardening
--
-- Drops the two crew per-day unique indexes and the activities_without_permit
-- column. The table and every check-in survive; the application degrades to
-- 465 behaviour (crew double-submissions become possible again, and the permit
-- finding is no longer visible on the board).

BEGIN;

DROP INDEX IF EXISTS hs_daily_checkins_one_crew_member_per_day;
DROP INDEX IF EXISTS hs_daily_checkins_one_crew_name_per_day;

ALTER TABLE hs_daily_checkins
  DROP COLUMN IF EXISTS activities_without_permit;

DELETE FROM schema_migrations WHERE filename = '466_hs_daily_checkins_review_fixes.sql';

COMMIT;
