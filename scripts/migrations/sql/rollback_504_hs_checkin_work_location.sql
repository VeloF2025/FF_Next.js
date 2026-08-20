-- Rollback 504. Office rows have no project and cannot satisfy the restored
-- NOT NULL, so they are deleted — they carry no payroll or attendance meaning,
-- only a fitness declaration that the worker can re-submit.
-- Announced, not silent: an operator running this under incident pressure
-- must see how many declarations this destroyed, not infer it afterwards.
DO $$
DECLARE
  removed bigint;
BEGIN
  DELETE FROM hs_daily_checkins WHERE work_location = 'office';
  GET DIAGNOSTICS removed = ROW_COUNT;
  RAISE NOTICE 'rollback 504: deleted % office check-in row(s)', removed;
END $$;

ALTER TABLE hs_daily_checkins
  DROP CONSTRAINT IF EXISTS hs_daily_checkins_site_needs_project;
ALTER TABLE hs_daily_checkins
  DROP CONSTRAINT IF EXISTS hs_daily_checkins_work_location_check;
ALTER TABLE hs_daily_checkins
  ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE hs_daily_checkins
  DROP COLUMN IF EXISTS work_location;
