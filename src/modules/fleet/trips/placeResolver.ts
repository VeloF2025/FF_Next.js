/**
 * Answers "where did this trip start and end" in two independent ways.
 *
 * 1. NEAREST KNOWN PLACE — a declared parking location or a project AOI. Internal, exact, free,
 *    and always available. Resolved in SQL so PostGIS does the geography rather than a JS
 *    approximation over a polygon.
 *
 * 2. LOCALITY — reverse-geocoded, persisted on the trip.
 *
 *    Note this is a LOCALITY, not a street address: the shared `reverseGeocode` is tuned for South
 *    Africa and returns { city, municipalDistrict, province }. Nominatim does return road-level
 *    detail in the same response, but that function discards it, and widening its return type
 *    would change a shared contract the parking and attendance-portal features depend on. So a
 *    trip reads "Centurion, City of Tshwane, Gauteng" rather than a street. If street-level is
 *    wanted later, extend `reverseGeocode` deliberately, with those callers in scope.
 *
 * The second is deliberately NOT resolved while trips are being built. The geocoder is Nominatim,
 * whose acceptable-use policy forbids systematic bulk querying, and it is shared with parking
 * compliance through one cache. Geocoding both ends of ~970 trips a week inline is exactly the
 * pattern that gets an IP blocked — which would take a working feature down alongside this one.
 * So addresses are filled afterwards, at a rate the policy permits, by a resolver that walks the
 * unresolved backlog. A trip is complete and useful without its address; the address arrives.
 *
 * The place label is SNAPSHOT onto the trip rather than joined at read time. Parking locations are
 * superseded over time, so resolving the name later would silently change what a historical trip
 * appears to say.
 */
import { query } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { getCachedGeocode, setCachedGeocode } from '@/modules/attendance/portal/geocodeCache';
import { reverseGeocode } from '@/utils/geoLocation';

const MODULE = 'FleetTripPlaces';

/**
 * Nominatim asks for at most one request per second. One per 1,100 ms leaves headroom for clock
 * jitter, and this is the entire reason the resolver is a separate pass.
 */
export const GEOCODE_INTERVAL_MS = 1100;

/** Beyond this a "nearest place" is not meaningfully near, and naming it would mislead. */
export const NEAREST_PLACE_MAX_M = 500;

export interface NearestPlace {
  id: string;
  kind: 'parking' | 'project_aoi';
  label: string | null;
  distanceM: number;
}

interface PlaceRow extends Record<string, unknown> {
  id: string;
  kind: string;
  label: string | null;
  distance_m: string | number;
}

/**
 * The nearest declared place to a coordinate, or null when nothing is close enough.
 *
 * Both sources are unioned and the closest wins. Parking locations are point+radius; project AOIs
 * are polygons, so ST_Distance against the geography gives 0 for a point inside the area — which
 * is the answer we want: "at the site", not "12 m from its centroid".
 */
export async function findNearestPlace(lat: number, lon: number): Promise<NearestPlace | null> {
  const rows = await query<PlaceRow>(
    `/* fleet-trips:nearest-place */
     WITH point AS (SELECT ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography AS g)
     SELECT id, kind, label, distance_m FROM (
       SELECT p.id,
              'parking'::text AS kind,
              COALESCE(p.label, p.address_text) AS label,
              ST_Distance(ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326)::geography, point.g) AS distance_m
       FROM fleet_vehicle_parking_locations p, point
       WHERE p.superseded_at IS NULL
         AND p.lat IS NOT NULL AND p.lon IS NOT NULL
       UNION ALL
       SELECT a.project_id,
              'project_aoi'::text AS kind,
              pr.project_name AS label,
              ST_Distance(a.aoi, point.g) AS distance_m
       -- The LEFT JOIN must bind to project_aois, not to the point CTE. Written as
       -- FROM project_aois a, point LEFT JOIN projects pr ON pr.id = a.project_id
       -- the join attaches to point instead, and Postgres refuses the reference to a.
       FROM project_aois a
       LEFT JOIN projects pr ON pr.id = a.project_id
       CROSS JOIN point
       WHERE a.aoi IS NOT NULL
     ) candidates
     WHERE distance_m <= $3
     ORDER BY distance_m
     LIMIT 1`,
    [lat, lon, NEAREST_PLACE_MAX_M],
  );

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind === 'parking' ? 'parking' : 'project_aoi',
    label: row.label,
    distanceM: Math.round(Number(row.distance_m) * 10) / 10,
  };
}

interface UnresolvedRow extends Record<string, unknown> {
  id: string;
  on_lat: string | number | null;
  on_lon: string | number | null;
  off_lat: string | number | null;
  off_lon: string | number | null;
  on_done: boolean;
  off_done: boolean;
}

function num(v: string | number | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Trips still missing a place or an address at either end, newest first. */
async function loadUnresolved(limit: number): Promise<UnresolvedRow[]> {
  return query<UnresolvedRow>(
    `/* fleet-trips:unresolved */
     SELECT id, on_lat, on_lon, off_lat, off_lon,
            (on_location_text IS NOT NULL OR on_lat IS NULL) AS on_done,
            (off_location_text IS NOT NULL OR off_lat IS NULL) AS off_done
     FROM fleet_vehicle_trips
     WHERE (on_location_text IS NULL AND on_lat IS NOT NULL)
        OR (off_location_text IS NULL AND off_lat IS NOT NULL)
     ORDER BY ignition_on_at DESC
     LIMIT $1`,
    [limit],
  );
}

/**
 * Resolves one coordinate to an address, through the SAME cache the parking feature uses.
 *
 * A cache hit costs nothing and is not rate-limited; only a miss reaches Nominatim, and the caller
 * paces those. A failure caches nothing and leaves the column null, so the trip is retried on a
 * later pass rather than being permanently stamped "unknown".
 */
function toLocality(g: { city?: string; municipalDistrict?: string; province?: string } | null): string | null {
  if (!g) return null;
  const parts = [g.city, g.municipalDistrict, g.province].filter((v) => v && v.trim() !== '');
  return parts.length > 0 ? parts.join(', ') : null;
}

async function resolveAddress(lat: number, lon: number): Promise<{ text: string | null; hitNetwork: boolean }> {
  const cached = getCachedGeocode(lat, lon);
  if (cached !== undefined) return { text: toLocality(cached), hitNetwork: false };
  try {
    const result = await reverseGeocode(lat, lon);
    setCachedGeocode(lat, lon, result);
    return { text: toLocality(result), hitNetwork: true };
  } catch (error) {
    log.warn(
      '[fleet-trips] reverse geocode failed; leaving the address unresolved for a later pass',
      { error: error instanceof Error ? error.name : 'unknown' },
      MODULE,
    );
    return { text: null, hitNetwork: true };
  }
}

export interface ResolveResult {
  tripsExamined: number;
  placesResolved: number;
  addressesResolved: number;
  networkCalls: number;
}

const sleep = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

/**
 * Fills places and addresses for up to `limit` trips.
 *
 * Nearest-place is resolved for every candidate — it is a local query with no rate limit. Address
 * lookups that miss the cache are paced at `GEOCODE_INTERVAL_MS`, so this pass takes roughly two
 * seconds per uncached trip and is bounded by `limit` rather than by the size of the backlog.
 */
export async function resolveTripPlaces(limit: number): Promise<ResolveResult> {
  const trips = await loadUnresolved(limit);
  const result: ResolveResult = {
    tripsExamined: trips.length, placesResolved: 0, addressesResolved: 0, networkCalls: 0,
  };

  for (const trip of trips) {
    const ends = [
      { prefix: 'on', lat: num(trip.on_lat), lon: num(trip.on_lon), done: trip.on_done },
      { prefix: 'off', lat: num(trip.off_lat), lon: num(trip.off_lon), done: trip.off_done },
    ] as const;

    for (const end of ends) {
      if (end.done || end.lat === null || end.lon === null) continue;

      const place = await findNearestPlace(end.lat, end.lon);
      if (place) result.placesResolved += 1;

      if (result.networkCalls > 0) await sleep(GEOCODE_INTERVAL_MS);
      const address = await resolveAddress(end.lat, end.lon);
      if (address.hitNetwork) result.networkCalls += 1;
      if (address.text) result.addressesResolved += 1;

      // Two explicit statements rather than a built-up column list: conditional tagged-template
      // SQL fragments are broken in this repo.
      if (end.prefix === 'on') {
        await query(
          `/* fleet-trips:resolve-on */
           UPDATE fleet_vehicle_trips
              SET on_location_text = COALESCE($2, on_location_text),
                  on_nearest_place_id = $3, on_nearest_place_kind = $4,
                  on_nearest_place_label = $5, on_nearest_place_distance_m = $6,
                  updated_at = now()
            WHERE id = $1`,
          [trip.id, address.text, place?.id ?? null, place?.kind ?? null,
            place?.label ?? null, place?.distanceM ?? null],
        );
      } else {
        await query(
          `/* fleet-trips:resolve-off */
           UPDATE fleet_vehicle_trips
              SET off_location_text = COALESCE($2, off_location_text),
                  off_nearest_place_id = $3, off_nearest_place_kind = $4,
                  off_nearest_place_label = $5, off_nearest_place_distance_m = $6,
                  updated_at = now()
            WHERE id = $1`,
          [trip.id, address.text, place?.id ?? null, place?.kind ?? null,
            place?.label ?? null, place?.distanceM ?? null],
        );
      }
    }
  }

  return result;
}
