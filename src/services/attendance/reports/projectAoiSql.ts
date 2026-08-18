/**
 * Project AOI (area-of-interest) geometry.
 *
 * `projects.latitude/longitude` is populated for exactly one of the 24
 * projects, so it cannot answer "which site is this clock-in near?". The pole
 * register can: `poles.project_id` + coordinates give thousands of surveyed
 * points per active project, and their convex hull is a serviceable site
 * boundary.
 *
 * Those hulls live in the `project_aois` table (migration 499), rebuilt by
 * `refresh_project_aois()` on a nightly cron. This module no longer builds
 * them: it used to carry its own inline CTE, which meant the same geometry
 * was defined twice once the clock-in path started recording matched AOIs —
 * two definitions that could silently disagree about which sites exist.
 *
 * Reading the table is also 25x faster. Measured on the live DB, a single
 * nearest-AOI lookup: 105 ms building the hull inline, 4.2 ms from the
 * indexed table.
 *
 * The SA bounding box and minimum-pole rule that used to live here now live
 * in `refresh_project_aois()`; see migration 499 for why each is load-bearing.
 */

/**
 * CTE body defining `project_aoi(project_id, aoi)` from the stored table.
 * Takes no parameters, so callers can concatenate it into a query without
 * disturbing their `$N` numbering.
 */
export const PROJECT_AOI_CTE = `
  project_aoi AS (
    SELECT a.project_id, a.aoi
    FROM project_aois a
  )
`;

/**
 * Freshness of the stored hulls, for reports that want to say so rather than
 * silently serve stale geometry when the refresh cron has stalled.
 */
export const PROJECT_AOI_COMPUTED_AT_SQL =
  'SELECT MAX(computed_at)::text AS computed_at FROM project_aois';

/** Refresh is daily; flag anything older than this as stale in report notes. */
export const AOI_STALE_AFTER_HOURS = 36;
