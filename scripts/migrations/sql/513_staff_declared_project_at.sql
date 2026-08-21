-- 513: when did a worker last tell us which project they are on?
--
-- staff.declared_project_id has existed for a long time but is written ONLY at
-- self-registration and never refreshed. Measured 2026-08-21 against the same
-- workers' most recent H&S daily check-in, it disagreed for 5 of the 15
-- technicians that could be compared — stale one time in three.
--
-- Without a timestamp there is no way to ask "has this worker told us TODAY",
-- which is the question the stores flow needs: field workers move between
-- sites, so a declaration from last week says nothing about where someone is
-- standing now.
--
-- NULL for every existing row is correct — none of those declarations has a
-- known date, and treating an undated one as fresh is exactly the mistake this
-- is meant to stop.
--
-- NOTE: the H&S daily check-in already captures a project every morning and is
-- the preferred signal. This column records an explicit portal declaration for
-- workers who have not checked in.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS declared_project_at TIMESTAMPTZ;

COMMENT ON COLUMN staff.declared_project_at IS
  'When declared_project_id was last confirmed by the worker. NULL means undated (set at registration, freshness unknown). Today''s H&S check-in takes precedence over this.';
