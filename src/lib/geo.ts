/**
 * Server-side geodesic helpers. Used by the attendance clock-in/out flow
 * to match device GPS against site geofences, and potentially by other
 * modules that need trusted distance calculations.
 *
 * Client code has its own copy in src/modules/fleet/offline/gpsCapture.ts
 * for UI affordances — that one is not the source of truth.
 */

const EARTH_RADIUS_M = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export interface LatLon {
  lat: number;
  lon: number;
}

/**
 * Distance between two coordinates in metres using the Haversine formula.
 * Accurate to ~0.5% for distances under 500 km, which is far more than
 * enough for checking whether a device is inside a site geofence.
 */
export function haversineDistanceM(a: LatLon, b: LatLon): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_M * c;
}

/** True when |lat| ≤ 90 and |lon| ≤ 180 and both are finite numbers. */
export function isValidLatLon(point: Partial<LatLon>): point is LatLon {
  return (
    typeof point.lat === 'number' &&
    typeof point.lon === 'number' &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lon) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lon >= -180 &&
    point.lon <= 180
  );
}
