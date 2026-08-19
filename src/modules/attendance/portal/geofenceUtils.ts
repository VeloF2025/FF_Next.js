/**
 * Match device GPS against project areas-of-interest for clock-in.
 *
 * Source of truth: `project_aois` — the convex hull of each project's
 * surveyed poles, rebuilt nightly by `refresh_project_aois()` (migration
 * 499). A clock-in is "inside" when the fix falls within a hull.
 *
 * This used to read `fleet_authorized_locations`, with `staff.home_site_id`
 * as a fallback. Both have been empty since the feature shipped — 0 rows and
 * 0 staff respectively — so `matchGeofence` returned `inside: false` for
 * every clock-in ever recorded and raised a `geofence_mismatch` on each one.
 * That is 2,261 of the 2,497 exceptions in the queue: one bug, not a
 * workload, and the reason nothing in that table has ever been resolved.
 * Reading an empty table forever is the failure this replaces, so do not
 * reintroduce a source that nobody populates.
 *
 * Policy is unchanged in one important respect: geofence matching is NEVER
 * a hard block. Missing a clock-in over a bad GPS reading or an unsurveyed
 * site is worse than letting the exception flow to the supervisor queue.
 */

import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import type { LatLon } from '@/lib/geo';

export interface GeofenceMatch {
  /** Nearest project AOI, or null when no AOI exists at all. */
  projectId: string | null;
  projectName: string | null;
  /** Metres to that AOI. 0 means inside the hull. Null when unmatched. */
  distanceM: number | null;
  /** Inside the hull. */
  inside: boolean;
  /**
   * Outside, but by less than the device's own reported error — the fix
   * cannot distinguish this from being inside, so it must not be treated as
   * a mismatch. GPS accuracy on these entries averages 37 m and reaches
   * 1,543 m; without this, bad receivers manufacture violations.
   */
  withinAccuracy: boolean;
}

interface NearestRow extends Record<string, unknown> {
  project_id: string;
  project_name: string | null;
  distance_m: string;
}

const UNMATCHED: GeofenceMatch = {
  projectId: null, projectName: null, distanceM: null,
  inside: false, withinAccuracy: false,
};

/**
 * Nearest project AOI to the device. Never throws for "no match" — an empty
 * `project_aois` (a stalled refresh) yields an unmatched result rather than
 * an error, because a clock-in must not fail on geofence infrastructure.
 */
export async function matchGeofence(args: {
  device: LatLon;
  accuracyM: number | null;
}): Promise<GeofenceMatch> {
  const { device, accuracyM } = args;

  try {
    const rows = await sql.query<NearestRow>(
      `SELECT a.project_id::text AS project_id,
              pr.project_name,
              ROUND(
                ST_Distance(
                  ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography,
                  a.aoi
                )::numeric, 2
              )::text AS distance_m
         FROM project_aois a
         LEFT JOIN projects pr ON pr.id = a.project_id
        ORDER BY 3 ASC
        LIMIT 1`,
      [device.lon, device.lat],
    );

    const row = rows[0];
    if (!row) {
      // No AOIs at all. Distinguish it in the log: this is a refresh
      // failure, not a worker standing in the wrong place.
      log.warn('[geofence] no project AOIs available — clock-in cannot be located', {
        lat: device.lat, lon: device.lon,
      });
      return UNMATCHED;
    }

    const distanceM = Number(row.distance_m);
    if (!Number.isFinite(distanceM)) {
      log.warn('[geofence] non-finite distance from project_aois', { distance: row.distance_m });
      return UNMATCHED;
    }

    return {
      projectId: row.project_id,
      projectName: row.project_name,
      distanceM,
      inside: distanceM <= 0,
      withinAccuracy: distanceM > 0 && accuracyM != null && distanceM <= accuracyM,
    };
  } catch (err) {
    // A geofence lookup failure must never cost someone their clock-in.
    log.error('[geofence] lookup failed, treating as unmatched', {
      error: err instanceof Error ? err.message : String(err),
    });
    return UNMATCHED;
  }
}
