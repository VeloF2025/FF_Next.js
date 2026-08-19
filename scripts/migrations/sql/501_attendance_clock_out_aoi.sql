-- 501_attendance_clock_out_aoi.sql
--
-- Mirror of 499's clock-IN AOI columns for the clock-OUT fix.
--
-- Why clock-out needs its own measurement: VF072 clocks in 16% on site but
-- clocks out 67% on site — he travels to site after clocking in. Judging a
-- shift by the clock-in fix alone misreads him as never reaching site, and
-- the reverse case (start on site, leave, clock out elsewhere) is invisible
-- entirely. Any future enforcement has to see both ends of the shift.
--
-- Recording only. Nothing here enforces anything, and clock-out is still
-- never rejected on geofence.
--
-- Additive and idempotent. NOTE: a dev deploy applies migrations to the
-- SHARED production database, so this lands in production the moment it
-- ships to dev — hence nullable columns only.

ALTER TABLE attendance_entries
  ADD COLUMN IF NOT EXISTS clock_out_aoi_project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS clock_out_aoi_distance_m numeric(10,2);

COMMENT ON COLUMN attendance_entries.clock_out_aoi_project_id IS
  'Nearest project AOI at clock-out, resolved at write time from project_aois. NULL when no project had a derivable AOI, for entries closed by the auto-close cron (no device fix exists), and for entries not closed through the portal clock-out path.';
COMMENT ON COLUMN attendance_entries.clock_out_aoi_distance_m IS
  'Metres from the clock-out fix to that AOI. 0 means inside the site boundary.';
