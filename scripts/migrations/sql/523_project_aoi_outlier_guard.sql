-- 523_project_aoi_outlier_guard.sql
--
-- Detect-and-flag guard for distorted project AOIs.
--
-- WHY THIS EXISTS
-- On 2026-08-21 a single pole was found assigned to the wrong project: captured
-- in QField under the default name "New pole", 145 km from every other pole in
-- that project, and physically inside a different project's site. One row out of
-- 2,816 inflated that project's convex hull from 4.1 km² to 258.9 km² — a 63x
-- blow-up. `project_aois` drives the attendance geofence that answers "was this
-- person on site?", so for months that question was answered against an area the
-- size of a metro. Nothing detected it and nothing would have detected the next
-- one.
--
-- WHAT THIS DOES *NOT* DO
-- It does not remove outliers from the hull the geofence uses. `aoi` still comes
-- from every in-bounds pole, exactly as before. The two failure directions are
-- not symmetric: an AOI that is too big under-detects (someone passes the
-- geofence who should not), while an AOI that is too small over-accuses (someone
-- is flagged off-site when they were on site) — in a system that feeds
-- disciplinary findings about named individuals. Silently trimming a hull with a
-- heuristic risks the second, and would quietly shrink the geofence of a
-- legitimately spread-out project. So: measure, persist, flag, and let a human
-- fix the pole.
--
-- THE OUTLIER RULE, AND THE DATA IT WAS CALIBRATED ON
-- A pole is an outlier when it is BOTH:
--   (a) further than OUTLIER_FLOOR_M (5 km) from the project's pole centroid, and
--   (b) further than OUTLIER_K (8x) the project's MEDIAN pole-to-centroid distance.
--
-- The centroid is the marginal median of latitude and longitude, not the mean
-- and not ST_Centroid: the mean of 2,816 poles is dragged ~50 m by one pole
-- 145 km away, and a measure the outlier can move is a measure the outlier can
-- hide behind. The median has a 50% breakdown point. The scale is the median
-- distance for the same reason — a p95 is contaminated once more than 5% of a
-- project's poles are misassigned.
--
-- Measured on the live pole register (2026-08-21, 9 projects, 32,044 in-bounds
-- poles), distance from the median centroid:
--
--   project          n     p50 m   p95 m   max m   max/p50
--   Mohadin        5397    1332    2705    3172     2.4
--   Lawley         4925     922    1644    1873     2.0
--   Thembisa POP 3 4607    1022    2023    2461     2.4
--   Etwatwa        4538     959    2206    2817     2.9
--   Grabouw        3793     913    1496    1820     2.0
--   Thembisa POP 1 2815     733    1689    2380     3.2
--   Tonga          2199     918    1509    1987     2.2
--   Mamelodi       1962     742    1627    2128     2.9
--   Themb'elihle   1808     473     852     997     2.1
--
-- So across every real project today the furthest pole sits at most 3.2x the
-- median distance and at most 3,172 m from the centroid. K=8 leaves 2.5x
-- headroom over the worst legitimate project; the 5 km floor leaves 1.6x. The
-- incident pole sat at 198x the median and 145 km out — 25x and 29x past the
-- respective thresholds. Replaying the incident against this rule flags exactly
-- one pole and reports a 34x area ratio; all eight other projects report zero
-- outliers and a ratio of exactly 1.00.
--
-- The floor is what stops a very tight project generating noise: without it, a
-- site whose poles all sit within 20 m of each other would flag anything 200 m
-- away. It is deliberately the only thing that can suppress a flag, and it is
-- set above every real site radius rather than at one.
--
-- Additive and idempotent. NOTE: a dev deploy applies migrations to the SHARED
-- production database, so this lands in production the moment it ships to dev —
-- hence nullable columns and a defaulted status only.

ALTER TABLE project_aois
  ADD COLUMN IF NOT EXISTS aoi_area_m2         numeric,
  ADD COLUMN IF NOT EXISTS robust_aoi_area_m2  numeric,
  ADD COLUMN IF NOT EXISTS aoi_area_ratio      numeric,
  ADD COLUMN IF NOT EXISTS outlier_pole_count  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS furthest_outlier_m  numeric,
  ADD COLUMN IF NOT EXISTS aoi_status          text    NOT NULL DEFAULT 'unassessed';

-- Named so a later widening is an ALTER, not a guess at an anonymous name.
DO $$
BEGIN
  ALTER TABLE project_aois
    ADD CONSTRAINT project_aois_aoi_status_check
    CHECK (aoi_status IN ('ok', 'suspect', 'distorted', 'unassessed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN project_aois.aoi_area_m2 IS
  'Area of the hull the geofence actually uses — every in-bounds pole included.';
COMMENT ON COLUMN project_aois.robust_aoi_area_m2 IS
  'Area of the hull with outlier poles excluded. Diagnostic ONLY — no query path uses this geometry. NULL when fewer than 3 non-outlier poles remain.';
COMMENT ON COLUMN project_aois.aoi_area_ratio IS
  'aoi_area_m2 / robust_aoi_area_m2. 1.0 means no outlier moved the hull. The 2026-08-21 incident measured 34.';
COMMENT ON COLUMN project_aois.outlier_pole_count IS
  'Poles further than both 5 km and 8x the median pole-to-centroid distance. See the migration header for the calibration.';
COMMENT ON COLUMN project_aois.furthest_outlier_m IS
  'Metres from the pole centroid to the furthest outlier. NULL when there are none.';
COMMENT ON COLUMN project_aois.aoi_status IS
  'ok = no outliers. suspect = outliers present but the hull is under 2x its robust area. distorted = 2x or more, or outliers exist and no robust hull is derivable. unassessed = never refreshed since this column was added.';

-- Cheap for 9 rows today; present so an alerting query stays an index scan as
-- the project count grows.
CREATE INDEX IF NOT EXISTS idx_project_aois_status ON project_aois (aoi_status);

-- Rebuild every project AOI from the pole register, and score each hull for
-- outlier distortion while the pole rows are already in hand.
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
  -- Calibrated on the live pole register; see the migration header for the
  -- distribution these came from. Changing either is a data decision, not a
  -- tuning knob — re-measure before you touch them.
  outlier_k       CONSTANT float8 := 8.0;
  outlier_floor_m CONSTANT float8 := 5000.0;
  distorted_ratio CONSTANT float8 := 2.0;
BEGIN
  WITH pts AS (
    SELECT p.project_id, p.longitude::float8 AS lon, p.latitude::float8 AS lat
    FROM poles p
    WHERE p.project_id IS NOT NULL
      AND p.latitude  BETWEEN -35 AND -22
      AND p.longitude BETWEEN 16 AND 33
  ), centres AS (
    -- Marginal median, NOT the mean and NOT ST_Centroid: a measure the outlier
    -- can move is a measure the outlier can hide behind.
    SELECT project_id,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY lat) AS mlat,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY lon) AS mlon
    FROM pts
    GROUP BY project_id
    HAVING COUNT(*) >= 3
  ), dists AS (
    SELECT p.project_id, p.lon, p.lat,
           ST_Distance(
             ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326)::geography,
             ST_SetSRID(ST_MakePoint(c.mlon, c.mlat), 4326)::geography
           ) AS d
    FROM pts p
    JOIN centres c ON c.project_id = p.project_id
  ), scale AS (
    SELECT project_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY d) AS med_d
    FROM dists
    GROUP BY project_id
  ), flagged AS (
    SELECT d.project_id, d.lon, d.lat, d.d,
           (d.d > outlier_floor_m AND d.d > outlier_k * s.med_d) AS is_outlier
    FROM dists d
    JOIN scale s ON s.project_id = d.project_id
  ), hulls AS (
    SELECT
      f.project_id,
      -- Unchanged from migration 499: the geofence hull still includes every
      -- in-bounds pole. Outliers are measured, never trimmed.
      ST_ConvexHull(ST_Collect(ST_SetSRID(ST_MakePoint(f.lon, f.lat), 4326)))::geography AS aoi,
      COUNT(*)::int AS pole_count,
      COUNT(*) FILTER (WHERE f.is_outlier)::int AS outlier_pole_count,
      COUNT(*) FILTER (WHERE NOT f.is_outlier)::int AS kept_count,
      MAX(f.d) FILTER (WHERE f.is_outlier) AS furthest_outlier_m,
      ST_ConvexHull(
        ST_Collect(ST_SetSRID(ST_MakePoint(f.lon, f.lat), 4326)) FILTER (WHERE NOT f.is_outlier)
      )::geography AS robust_aoi
    FROM flagged f
    GROUP BY f.project_id
  ), scored AS (
    SELECT
      h.project_id, h.aoi, h.pole_count, h.outlier_pole_count, h.furthest_outlier_m,
      ST_Area(h.aoi) AS full_area,
      -- Two or fewer survivors give a line or a point, whose area is 0 and
      -- whose ratio would be a division by zero dressed up as an answer.
      CASE WHEN h.kept_count >= 3 THEN ST_Area(h.robust_aoi) END AS robust_area
    FROM hulls h
  ), upserted AS (
    INSERT INTO project_aois (
      project_id, aoi, pole_count, computed_at,
      aoi_area_m2, robust_aoi_area_m2, aoi_area_ratio,
      outlier_pole_count, furthest_outlier_m, aoi_status
    )
    SELECT
      s.project_id, s.aoi, s.pole_count, NOW(),
      ROUND(s.full_area::numeric, 2),
      CASE WHEN s.robust_area > 0 THEN ROUND(s.robust_area::numeric, 2) END,
      CASE WHEN s.robust_area > 0 THEN ROUND((s.full_area / s.robust_area)::numeric, 3) END,
      s.outlier_pole_count,
      ROUND(s.furthest_outlier_m::numeric, 2),
      CASE
        WHEN s.outlier_pole_count = 0 THEN 'ok'
        -- Outliers exist and no robust hull is derivable: we cannot show the
        -- hull is undistorted, so we do not get to call it clean. Bias to
        -- shouting — a false alarm costs someone a look at a map, a miss costs
        -- months of a metro-sized geofence.
        WHEN s.robust_area IS NULL OR s.robust_area <= 0 THEN 'distorted'
        WHEN s.full_area / s.robust_area >= distorted_ratio THEN 'distorted'
        ELSE 'suspect'
      END
    FROM scored s
    -- A pole may reference a project row that no longer exists; the FK would
    -- abort the whole refresh over one orphan.
    JOIN projects pr ON pr.id = s.project_id
    ON CONFLICT (project_id) DO UPDATE
      SET aoi                = EXCLUDED.aoi,
          pole_count         = EXCLUDED.pole_count,
          computed_at        = EXCLUDED.computed_at,
          aoi_area_m2        = EXCLUDED.aoi_area_m2,
          robust_aoi_area_m2 = EXCLUDED.robust_aoi_area_m2,
          aoi_area_ratio     = EXCLUDED.aoi_area_ratio,
          outlier_pole_count = EXCLUDED.outlier_pole_count,
          furthest_outlier_m = EXCLUDED.furthest_outlier_m,
          aoi_status         = EXCLUDED.aoi_status
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
  'Rebuilds project_aois from the pole register and scores each hull for outlier distortion (migration 523). Returns the number of AOIs written. Safe to run repeatedly.';

-- Score the existing hulls immediately, so a distortion already in the data is
-- visible from the moment this migration lands rather than at the next cron.
SELECT refresh_project_aois();
