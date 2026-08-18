-- 499_attendance_project_aois.sql
--
-- Area-of-interest geometry per project, plus the columns that record which
-- AOI a clock-in actually landed in.
--
-- Why a table and not a query-time CTE: building the hulls aggregates ~32k
-- pole rows. Measured on this database, a single nearest-AOI lookup costs
-- 105 ms from the CTE and 4.2 ms from an indexed table. The clock-in path
-- runs inside a transaction holding the staff gate lock, on a phone that is
-- already waiting on a selfie upload — 105 ms of hull-building per clock-in
-- is not affordable there.
--
-- Nothing in this migration enforces anything. `aoi_enforcement_enabled`
-- exists so HR can opt individual staff in later; it is read by no code yet.
--
-- Additive and idempotent throughout. NOTE: a dev deploy applies migrations
-- to the SHARED production database, so this lands in production the moment
-- it ships to dev — hence nullable columns and a defaulted flag only.

CREATE TABLE IF NOT EXISTS project_aois (
  project_id  uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  aoi         geography(Geometry, 4326) NOT NULL,
  pole_count  integer NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE project_aois IS
  'Convex hull of each project''s surveyed poles, refreshed by refresh_project_aois(). Derived data — safe to truncate and rebuild.';
COMMENT ON COLUMN project_aois.computed_at IS
  'When this hull was last rebuilt. Consumers surface it so a stalled refresh is visible rather than silently serving stale geometry.';

CREATE INDEX IF NOT EXISTS idx_project_aois_aoi ON project_aois USING GIST (aoi);

-- Rebuild every project AOI from the pole register.
--
-- The South Africa bounding box is also the NaN guard: poles.latitude is
-- numeric and holds NaN rows from bad imports, which make ST_ConvexHull error
-- outright. BETWEEN on numeric excludes NaN because Postgres sorts NaN above
-- every non-NaN value. Do NOT "simplify" it to IS NOT NULL.
--
-- Fewer than 3 poles yields a point or a line rather than an area, which
-- would let a barely-surveyed project win "nearest" over a real site.
CREATE OR REPLACE FUNCTION refresh_project_aois()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  n integer;
BEGIN
  WITH hulls AS (
    SELECT
      p.project_id,
      ST_ConvexHull(
        ST_Collect(ST_SetSRID(ST_MakePoint(p.longitude::float8, p.latitude::float8), 4326))
      )::geography AS aoi,
      COUNT(*)::int AS pole_count
    FROM poles p
    WHERE p.project_id IS NOT NULL
      AND p.latitude  BETWEEN -35 AND -22
      AND p.longitude BETWEEN 16 AND 33
    GROUP BY p.project_id
    HAVING COUNT(*) >= 3
  ), upserted AS (
    INSERT INTO project_aois (project_id, aoi, pole_count, computed_at)
    SELECT h.project_id, h.aoi, h.pole_count, NOW()
      FROM hulls h
      -- A pole may reference a project row that no longer exists; the FK would
      -- abort the whole refresh over one orphan.
      JOIN projects pr ON pr.id = h.project_id
    ON CONFLICT (project_id) DO UPDATE
      SET aoi = EXCLUDED.aoi,
          pole_count = EXCLUDED.pole_count,
          computed_at = EXCLUDED.computed_at
    RETURNING project_id
  )
  SELECT COUNT(*) INTO n FROM upserted;

  -- Drop AOIs for projects whose poles fell below the threshold or were
  -- removed, so a stale hull cannot keep matching clock-ins.
  DELETE FROM project_aois pa
   WHERE NOT EXISTS (
     SELECT 1 FROM poles p
      WHERE p.project_id = pa.project_id
        AND p.latitude  BETWEEN -35 AND -22
        AND p.longitude BETWEEN 16 AND 33
      GROUP BY p.project_id
     HAVING COUNT(*) >= 3
   );

  RETURN n;
END $$;

COMMENT ON FUNCTION refresh_project_aois() IS
  'Rebuilds project_aois from the pole register. Returns the number of AOIs written. Safe to run repeatedly.';

-- Which AOI the clock-in landed in, recorded at write time. Stored rather
-- than recomputed on read because pole data changes: the answer must be
-- as-of the clock-in, not as-of whenever someone opens a report.
ALTER TABLE attendance_entries
  ADD COLUMN IF NOT EXISTS clock_in_aoi_project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS clock_in_aoi_distance_m numeric(10,2);

COMMENT ON COLUMN attendance_entries.clock_in_aoi_project_id IS
  'Nearest project AOI at clock-in. NULL when no GPS fix, or when no project had a derivable AOI.';
COMMENT ON COLUMN attendance_entries.clock_in_aoi_distance_m IS
  'Metres from the clock-in fix to that AOI. 0 means inside the site boundary.';

-- Per-staff opt-in for future geofence enforcement. Default OFF, read by no
-- code yet — the measurement period runs first.
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS aoi_enforcement_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN staff.aoi_enforcement_enabled IS
  'HR opt-in for AOI geofence enforcement at clock-in. Default false. No code reads this yet.';

-- Populate immediately so the first clock-in after deploy has AOIs to match.
SELECT refresh_project_aois();
