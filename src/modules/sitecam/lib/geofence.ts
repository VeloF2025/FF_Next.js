// src/modules/sitecam/lib/geofence.ts

/** Distance (m) beyond which a capture is flagged out-of-range for QA. */
export const GEOFENCE_THRESHOLD_M = 25;

export type GeofenceStatus =
  | 'on_site'
  | 'out_of_range'
  | 'device_gps_off'
  | 'no_planned_coords';

/** Inputs to the classifier. All coords nullable. */
export interface GeofenceInput {
  plannedLat: number | null;
  plannedLon: number | null;
  deviceLat: number | null;
  deviceLon: number | null;
  accuracyM: number | null;
}

/** Classification result carried from entry → wizard → upload. */
export interface GeofenceReading extends GeofenceInput {
  status: GeofenceStatus;
  distanceM: number | null;
}

/** Reading plus the submit-time second GPS stamp — the persisted shape. */
export interface GeofencePayload extends GeofenceReading {
  submitLat: number | null;
  submitLon: number | null;
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance between two lat/lon points, in metres. */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Classify a device position against planned coords. Precedence:
 *  1. planned missing            → no_planned_coords (nothing to compare)
 *  2. device missing             → device_gps_off
 *  3. distance - accuracy > 25 m → out_of_range (accuracy slack absorbs GPS jitter)
 *  4. otherwise                  → on_site
 */
export function classifyGeofence(
  input: GeofenceInput,
): { status: GeofenceStatus; distanceM: number | null } {
  const { plannedLat, plannedLon, deviceLat, deviceLon, accuracyM } = input;
  if (plannedLat === null || plannedLon === null) {
    return { status: 'no_planned_coords', distanceM: null };
  }
  if (deviceLat === null || deviceLon === null) {
    return { status: 'device_gps_off', distanceM: null };
  }
  const distanceM = haversineMeters(plannedLat, plannedLon, deviceLat, deviceLon);
  const slack = accuracyM ?? 0;
  const status: GeofenceStatus =
    distanceM - slack > GEOFENCE_THRESHOLD_M ? 'out_of_range' : 'on_site';
  return { status, distanceM };
}

/** Build the full reading (input + classification) in one call. */
export function buildReading(input: GeofenceInput): GeofenceReading {
  return { ...input, ...classifyGeofence(input) };
}

/**
 * Encode a reading for a URL query param. Plain JSON — the Next.js router
 * percent-encodes query values itself, so encoding here double-encodes.
 */
export function encodeGeofenceParam(reading: GeofenceReading): string {
  return JSON.stringify(reading);
}

/** Decode the query param back into a reading; null when absent/malformed. */
export function decodeGeofenceParam(
  raw: string | string[] | undefined,
): GeofenceReading | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    return JSON.parse(raw) as GeofenceReading;
  } catch {
    // Tolerate the pre-fix double-encoded form (in-flight URLs at deploy time).
    try {
      return JSON.parse(decodeURIComponent(raw)) as GeofenceReading;
    } catch {
      return null;
    }
  }
}

/** Human-readable distance for geofence warnings: metres below 1 km, else km. */
export function formatGeofenceDistance(distanceM: number): string {
  if (distanceM < 1000) return `${Math.round(distanceM)} m`;
  const km = distanceM / 1000;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

/**
 * Read the device location once. Resolves null (never rejects) when geolocation
 * is unavailable, denied, or times out — the caller treats null as device_gps_off.
 */
export function readDeviceLocation(
  timeoutMs: number,
): Promise<{ lat: number; lon: number; accuracy: number | null } | null> {
  return new Promise((resolve) => {
    const geo =
      typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) {
      resolve(null);
      return;
    }
    geo.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
