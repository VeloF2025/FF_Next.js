/**
 * Match device GPS against site geofences for clock-in / clock-out.
 *
 * Sources of truth:
 *   - `fleet_authorized_locations` — seeded with site (and accommodation)
 *     polygons, where `radius_km` defines an inclusion circle around
 *     (lat, lon). Re-used from the fleet module rather than duplicating
 *     a new `attendance_sites` table.
 *   - `staff.home_site_id` — optional default site for staff that work
 *     the same location every day (most field crews).
 *
 * Policy (Phase 1a):
 *   - If device is inside any active site's radius, return that site.
 *   - If not, and staff has a `home_site_id`, return that site anyway
 *     but flag the entry as a geofence mismatch for review.
 *   - If staff has no home_site_id, still allow the clock-in but with a
 *     null site_geofence_id and a mismatch exception.
 *
 * Geofence matching is never a hard block — missing a clock-in because
 * of a bad GPS reading or an unmapped site is a worse outcome than
 * letting the exception flow through to the supervisor queue.
 */

import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { haversineDistanceM, isValidLatLon, type LatLon } from '@/lib/geo';

export interface GeofenceMatch {
  siteId: string | null;
  siteName: string | null;
  distanceM: number | null;
  /** true when the device GPS was inside a site's radius. */
  inside: boolean;
  /** true when the matched site came from `staff.home_site_id`
   *  rather than a radius hit — UI can show a softer confirmation. */
  fallback: boolean;
}

interface SiteRow extends Record<string, unknown> {
  id: string;
  name: string;
  lat: string | number;
  lon: string | number;
  radius_km: string | number;
}

/**
 * Find the nearest active site whose geofence includes the device GPS.
 * Falls back to the staff's home site if no radius hit. Returns a
 * `GeofenceMatch` describing the outcome; never throws for "no match".
 */
export async function matchGeofence(args: {
  device: LatLon;
  homeSiteId: string | null;
}): Promise<GeofenceMatch> {
  const { device, homeSiteId } = args;

  // Pull the active, site-scoped geofences. `is_global=true` entries apply
  // to any vehicle in the fleet model — we include them here too since the
  // attendance portal isn't vehicle-scoped.
  const sites = await sql<SiteRow>`
    SELECT id, name, lat, lon, radius_km
    FROM fleet_authorized_locations
    WHERE is_active = true
      AND location_type IN ('work_site', 'office', 'accommodation')
  `;

  let bestHit: { siteId: string; siteName: string; distanceM: number; radiusM: number } | null = null;

  for (const site of sites) {
    const siteLat = Number(site.lat);
    const siteLon = Number(site.lon);
    const radiusKm = Number(site.radius_km);
    if (!Number.isFinite(siteLat) || !Number.isFinite(siteLon) || !Number.isFinite(radiusKm) || radiusKm <= 0) {
      log.warn('[geofence] skipping malformed site row', {
        siteId: site.id,
        lat: site.lat,
        lon: site.lon,
        radius_km: site.radius_km,
      });
      continue;
    }
    const radiusM = radiusKm * 1000;
    const siteCoord = { lat: siteLat, lon: siteLon };
    if (!isValidLatLon(siteCoord)) continue;
    const dM = haversineDistanceM(device, siteCoord);

    if (dM <= radiusM) {
      // Prefer the tightest enclosing geofence — a staff member standing in
      // the intersection of "Lawley POP 1 (100m)" and "Lawley region (5km)"
      // should clock into POP 1, not the region. Compare radius-to-radius
      // (smaller enclosing circle wins); break ties on closer distance,
      // then on site id for full determinism regardless of DB row order.
      if (
        bestHit == null ||
        radiusM < bestHit.radiusM ||
        (radiusM === bestHit.radiusM && dM < bestHit.distanceM) ||
        (radiusM === bestHit.radiusM && dM === bestHit.distanceM && site.id < bestHit.siteId)
      ) {
        bestHit = { siteId: site.id, siteName: site.name, distanceM: dM, radiusM };
      }
    }
  }

  if (bestHit) {
    return {
      siteId: bestHit.siteId,
      siteName: bestHit.siteName,
      distanceM: bestHit.distanceM,
      inside: true,
      fallback: false,
    };
  }

  // No radius hit. Fall back to the staff's home site if present — and
  // if the home site's stored coordinates are actually valid.
  if (homeSiteId) {
    const homeRows = await sql<SiteRow>`
      SELECT id, name, lat, lon, radius_km
      FROM fleet_authorized_locations
      WHERE id = ${homeSiteId} AND is_active = true
      LIMIT 1
    `;
    const home = homeRows[0];
    if (home) {
      const homeCoord = { lat: Number(home.lat), lon: Number(home.lon) };
      if (!isValidLatLon(homeCoord)) {
        // Malformed home site — refuse to fall back to it. Better to flag
        // the clock-in as a full mismatch than to silently emit NaN
        // distances that downstream code coerces to null.
        log.warn('[geofence] home site has invalid coordinates, not falling back', {
          homeSiteId,
          lat: home.lat,
          lon: home.lon,
        });
      } else {
        return {
          siteId: home.id,
          siteName: home.name,
          distanceM: haversineDistanceM(device, homeCoord),
          inside: false,
          fallback: true,
        };
      }
    }
  }

  return { siteId: null, siteName: null, distanceM: null, inside: false, fallback: false };
}
