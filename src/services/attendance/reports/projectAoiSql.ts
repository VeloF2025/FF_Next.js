/**
 * Project AOI (area-of-interest) geometry, derived from QField pole data.
 *
 * `projects.latitude/longitude` is populated for exactly one of the 24
 * projects, so it cannot answer "which site is this clock-in near?". The
 * pole register can: `poles.project_id` + `poles.latitude/longitude` gives
 * thousands of surveyed points per active project, and their convex hull is
 * a serviceable site boundary.
 *
 * Two things the SQL below is deliberate about:
 *
 *  - **SA bounds filter.** `poles.latitude/longitude` are `numeric`, and the
 *    column holds NaN/Inf rows from bad imports. `ST_ConvexHull` errors
 *    outright on those. A `BETWEEN` on numeric excludes NaN (Postgres sorts
 *    NaN above every non-NaN value), so the bounds filter doubles as the
 *    NaN guard — do not "simplify" it to an `IS NOT NULL`.
 *
 *  - **MATERIALIZED.** Without the hint Postgres inlines the CTE into the
 *    per-row LATERAL that finds the nearest project, re-aggregating ~32k
 *    poles for every event row: 4.9 s vs 107 ms for a 14-day window measured
 *    against the live DB.
 */

/** South Africa mainland bounding box; also the NaN/Inf guard. See above. */
export const SA_LAT_MIN = -35;
export const SA_LAT_MAX = -22;
export const SA_LON_MIN = 16;
export const SA_LON_MAX = 33;

/**
 * Minimum poles before a project gets an AOI. A hull of one or two points is
 * a point or a line — geometrically valid, but it would let a barely-surveyed
 * project win "nearest" over a real site boundary.
 */
export const MIN_POLES_FOR_AOI = 3;

/**
 * CTE body defining `project_aoi(project_id, aoi)`. Takes no parameters —
 * every value in it is a compile-time constant — so callers can concatenate
 * it into a query without disturbing their `$N` numbering.
 */
export const PROJECT_AOI_CTE = `
  project_aoi AS MATERIALIZED (
    SELECT
      p.project_id,
      ST_ConvexHull(
        ST_Collect(ST_SetSRID(ST_MakePoint(p.longitude::float8, p.latitude::float8), 4326))
      )::geography AS aoi
    FROM poles p
    WHERE p.project_id IS NOT NULL
      AND p.latitude  BETWEEN ${SA_LAT_MIN} AND ${SA_LAT_MAX}
      AND p.longitude BETWEEN ${SA_LON_MIN} AND ${SA_LON_MAX}
    GROUP BY p.project_id
    HAVING COUNT(*) >= ${MIN_POLES_FOR_AOI}
  )
`;
