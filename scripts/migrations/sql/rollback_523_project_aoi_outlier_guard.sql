-- rollback_523_project_aoi_outlier_guard.sql
--
-- Reverses 523: drops the distortion-scoring columns, their CHECK constraint
-- and index, and restores refresh_project_aois() to the migration 499 body.
--
-- The function body below is a verbatim copy of the one in
-- 499_attendance_project_aois.sql. If 499 is ever edited, this copy must be
-- re-synced by hand — a rollback that resurrects a stale function is worse
-- than one that fails loudly.
--
-- project_aois itself is derived data: dropping the scoring columns loses
-- nothing that the next refresh does not recompute.

DROP INDEX IF EXISTS idx_project_aois_status;

ALTER TABLE project_aois
  DROP CONSTRAINT IF EXISTS project_aois_aoi_status_check;

ALTER TABLE project_aois
  DROP COLUMN IF EXISTS aoi_area_m2,
  DROP COLUMN IF EXISTS robust_aoi_area_m2,
  DROP COLUMN IF EXISTS aoi_area_ratio,
  DROP COLUMN IF EXISTS outlier_pole_count,
  DROP COLUMN IF EXISTS furthest_outlier_m,
  DROP COLUMN IF EXISTS aoi_status,
  DROP COLUMN IF EXISTS aoi_status_reason,
  DROP COLUMN IF EXISTS previous_aoi_area_m2,
  DROP COLUMN IF EXISTS previous_aoi_status,
  DROP COLUMN IF EXISTS aoi_growth_ratio;

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
