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
-- TWO INDEPENDENT SIGNALS, BECAUSE ONE HAS A STRUCTURAL BLIND SPOT
--
-- The first version of this guard derived its status from the outlier RATIO
-- alone. An adversarial review measured what that actually tracks, and it is
-- not distortion — it is the SPLIT of a project between two areas. Measured on
-- 1,000-pole synthetic shapes (read-only, against the live database):
--
--   shape                                    outliers  full km²  ratio  verdict
--   two genuine areas 8 km apart, 50/50            0     23.83   1.00   ok
--   the same shape, 70/30                         22     23.98   1.03   ok
--   the same shape, 90/10                         99     22.74   1.89   ALARM
--   3 km cluster + 27 km feeder spur, 80/20       60    118.89   1.35   ALARM
--   mid-import: 3 tight poles + 1 node 6 km out    1      0.12    n/a   ALARM
--   pure linear run, 30 km                         0      1.12   1.00   ok
--   pure linear run, 60 km                         0      2.20   1.00   ok
--   the 2026-08-21 incident                        1    357.28  17.16   ALARM
--
-- The 50/50 and 90/10 rows are the tell: 23.83 km² and 22.74 km² are the same
-- geometry, and the ratio rule called one clean and the other distorted. Worse,
-- raising a false alarm needs a DENSITY GRADIENT — dense distribution plus a
-- long feeder — which is precisely what real fibre topology looks like. A guard
-- that cries wolf on real topology manufactures the muted channel it was
-- written to prevent.
--
-- So the ratio signal is kept but DEMOTED: it can no longer raise `distorted`
-- on its own. Two absolute signals were added, each with a different blind
-- spot, and either one alone is enough to raise `distorted`:
--
--   S1 ABSOLUTE AREA — aoi_area_m2 > 150 km².
--     What only S1 catches: a metro-sized hull with no outlier pole at all —
--     the 50/50 split above, which the ratio rule structurally cannot see.
--     Calibration: the largest live project is Mohadin at 9.72 km² (15x
--     headroom) and the largest LEGITIMATE synthetic shape is the 27 km feeder
--     spur at 118.89 km². The spur is the binding constraint, not the live
--     data, and 150 km² clears it by only 1.26x while catching the incident's
--     357.28 km² by 2.4x. That is thin, and it is thin for a real reason: hull
--     area grows quadratically with extent, so a long feeder inflates it
--     enormously while being operationally narrow (compare the 60 km linear
--     run at 2.20 km²). RE-MEASURE THIS CONSTANT if a project with a feeder
--     much beyond 27 km is onboarded — a 40 km spur would breach it.
--
--   S2 AREA GROWTH — the hull grew 5x or more since the previous refresh,
--     floored at a previous area of 1 km² and a new area of 25 km².
--     What only S2 catches: a distortion that stays under S1's cap. A pole
--     misassigned 10 km out of a 2 km site takes the hull from ~4 km² to
--     ~40 km² — invisible to S1, an 10x step to S2. Both floors exist to keep
--     an import in progress quiet: early in a survey a hull legitimately
--     multiplies from nothing, which is why no baseline means no signal.
--     5x rather than 4x puts distance between this and a legitimate phase-two
--     import, which can plausibly double or triple a hull in one night.
--
--   S3 OUTLIER RATIO — kept, persisted, queryable, and capped at `suspect`.
--     There is NO threshold that separates a legitimate split from a real
--     distortion, and the measurements say so directly. Splitting the same two
--     genuine areas more unevenly RAISES the ratio: 90/10 measures 1.89, but
--     99/1 measures 3.66, 95/5 measures 4.24 and 97/3 measures 4.33 — all above
--     any cut-off worth setting, and all perfectly healthy. So the 2.0 constant
--     below is not calibrated against anything; it only chooses which
--     non-alerting label a row carries, and it is deliberately left at the
--     simplest value rather than tuned to look principled. `suspect` never
--     alerts. It is a record that the hull moved, for a human who goes looking.
--
-- Both absolute signals catch the 2026-08-21 incident independently: 357.28 km²
-- is 2.4x S1, and 4.10 -> 357.28 km² is an 87x step against S2.
--
-- THE OUTLIER RULE ITSELF, AND THE DATA IT WAS CALIBRATED ON
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
  ADD COLUMN IF NOT EXISTS aoi_status          text    NOT NULL DEFAULT 'unassessed',
  ADD COLUMN IF NOT EXISTS aoi_status_reason   text,
  ADD COLUMN IF NOT EXISTS previous_aoi_area_m2 numeric,
  ADD COLUMN IF NOT EXISTS previous_aoi_status  text,
  ADD COLUMN IF NOT EXISTS aoi_growth_ratio     numeric;

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
COMMENT ON COLUMN project_aois.aoi_status_reason IS
  'Which signal raised the status: absolute_area (S1), area_growth (S2), outlier_ratio or no_robust_hull (S3). NULL when ok. Kept so an alert can say WHY without re-deriving it.';
COMMENT ON COLUMN project_aois.previous_aoi_area_m2 IS
  'aoi_area_m2 as it stood before this refresh. NULL on a project''s first scored refresh, which is also what suppresses the growth signal during an import.';
COMMENT ON COLUMN project_aois.previous_aoi_status IS
  'aoi_status as it stood before this refresh. The nightly alerter fires only on a transition INTO an alerting state, so a distortion left unfixed does not message someone every night.';
COMMENT ON COLUMN project_aois.aoi_growth_ratio IS
  'aoi_area_m2 / previous_aoi_area_m2. NULL with no baseline. The 2026-08-21 incident would have measured 87.';
COMMENT ON COLUMN project_aois.aoi_status IS
  'distorted = an absolute signal fired (hull over 150 km², or a 5x jump since the last refresh) — this alerts. suspect = the outlier ratio moved but no absolute signal fired — recorded, queryable, does NOT alert. ok = neither. unassessed = never refreshed since this column was added.';

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
  -- S3's threshold is NOT calibrated, and cannot be: see the header. It only
  -- decides which non-alerting label a row carries.
  suspect_ratio   CONSTANT float8 := 2.0;
  -- S1: above every legitimate shape measured, below the incident. See header.
  oversize_area_m2 CONSTANT float8 := 150e6;
  -- S2 and its two floors. No baseline, or a hull still small, means no signal.
  growth_factor        CONSTANT float8 := 5.0;
  growth_min_prev_m2   CONSTANT float8 := 1e6;
  growth_min_new_m2    CONSTANT float8 := 25e6;
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
      CASE WHEN h.kept_count >= 3 THEN ST_Area(h.robust_aoi) END AS robust_area,
      -- The baseline for signal S2. A CTE reads the snapshot taken at statement
      -- start, so this is the PREVIOUS refresh's value even though the same
      -- statement is about to overwrite it. NULL for a project being scored for
      -- the first time, which is exactly what keeps an import in progress quiet.
      prev.aoi_area_m2::float8 AS prev_area,
      prev.aoi_status AS prev_status
    FROM hulls h
    LEFT JOIN project_aois prev ON prev.project_id = h.project_id
  ), signalled AS (
    SELECT
      s.*,
      -- S1: bigger than any legitimate fibre project shape measured.
      (s.full_area > oversize_area_m2) AS sig_oversize,
      -- S2: a step change against this project's own previous hull. Both floors
      -- must clear, or an early import multiplying from nothing would trip it.
      (s.prev_area IS NOT NULL
        AND s.prev_area >= growth_min_prev_m2
        AND s.full_area >= growth_min_new_m2
        AND s.full_area >= growth_factor * s.prev_area) AS sig_growth,
      -- S3, capped at `suspect`. Outliers with no derivable robust hull count
      -- here too: we cannot show the hull is undistorted, but on its own that
      -- is not evidence the geofence is wrong — the mid-import shape in the
      -- header measured 0.12 km² and used to raise a full alarm.
      (s.outlier_pole_count > 0
        AND (s.robust_area IS NULL OR s.robust_area <= 0
             OR s.full_area / s.robust_area >= suspect_ratio)) AS sig_ratio
    FROM scored s
  ), upserted AS (
    INSERT INTO project_aois (
      project_id, aoi, pole_count, computed_at,
      aoi_area_m2, robust_aoi_area_m2, aoi_area_ratio,
      outlier_pole_count, furthest_outlier_m, aoi_status, aoi_status_reason,
      previous_aoi_area_m2, previous_aoi_status, aoi_growth_ratio
    )
    SELECT
      s.project_id, s.aoi, s.pole_count, NOW(),
      ROUND(s.full_area::numeric, 2),
      CASE WHEN s.robust_area > 0 THEN ROUND(s.robust_area::numeric, 2) END,
      CASE WHEN s.robust_area > 0 THEN ROUND((s.full_area / s.robust_area)::numeric, 3) END,
      s.outlier_pole_count,
      ROUND(s.furthest_outlier_m::numeric, 2),
      -- Either absolute signal is sufficient for `distorted`; the ratio signal
      -- alone never is. See the header for what each one uniquely catches.
      CASE
        WHEN s.sig_oversize OR s.sig_growth THEN 'distorted'
        WHEN s.sig_ratio THEN 'suspect'
        ELSE 'ok'
      END,
      CASE
        WHEN s.sig_oversize THEN 'absolute_area'
        WHEN s.sig_growth THEN 'area_growth'
        WHEN s.sig_ratio AND (s.robust_area IS NULL OR s.robust_area <= 0) THEN 'no_robust_hull'
        WHEN s.sig_ratio THEN 'outlier_ratio'
      END,
      CASE WHEN s.prev_area IS NOT NULL THEN ROUND(s.prev_area::numeric, 2) END,
      s.prev_status,
      CASE WHEN s.prev_area > 0 THEN ROUND((s.full_area / s.prev_area)::numeric, 3) END
    FROM signalled s
    -- A pole may reference a project row that no longer exists; the FK would
    -- abort the whole refresh over one orphan.
    JOIN projects pr ON pr.id = s.project_id
    ON CONFLICT (project_id) DO UPDATE
      SET aoi                  = EXCLUDED.aoi,
          pole_count           = EXCLUDED.pole_count,
          computed_at          = EXCLUDED.computed_at,
          aoi_area_m2          = EXCLUDED.aoi_area_m2,
          robust_aoi_area_m2   = EXCLUDED.robust_aoi_area_m2,
          aoi_area_ratio       = EXCLUDED.aoi_area_ratio,
          outlier_pole_count   = EXCLUDED.outlier_pole_count,
          furthest_outlier_m   = EXCLUDED.furthest_outlier_m,
          aoi_status           = EXCLUDED.aoi_status,
          aoi_status_reason    = EXCLUDED.aoi_status_reason,
          previous_aoi_area_m2 = EXCLUDED.previous_aoi_area_m2,
          previous_aoi_status  = EXCLUDED.previous_aoi_status,
          aoi_growth_ratio     = EXCLUDED.aoi_growth_ratio
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
