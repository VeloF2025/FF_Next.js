/**
 * GET /api/geocode?lat=<number>&lon=<number>
 *
 * Same-origin proxy for reverse-geocoding GPS coordinates to a
 * structured SA address ({ city, municipalDistrict, province }).
 *
 * Why this exists: the app CSP (`middleware.ts` connect-src) does not
 * allowlist nominatim.openstreetmap.org, so a browser `fetch` to OSM is
 * blocked. Authenticated browsers call us (same origin, CSP-exempt) and
 * we call Nominatim server-side with a TTL cache + in-flight dedupe.
 * That keeps the OSM free-tier happy (1 req/s, policy-friendly UA) and
 * keeps user IPs out of OpenStreetMap's logs (POPIA). Mirrors the
 * staff-portal endpoint `pages/api/my/geocode.ts`, gated on RBAC auth
 * instead of the /my session.
 *
 * Response shape is always 200 + `{ geocode: GeocodeResult | null }`:
 *   - Resolved successfully → geocode is the structured address.
 *   - Nominatim down, rate-limited, or returned no useful data → null.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { isValidLatLon } from '@/lib/geo';
import { log } from '@/lib/logger';
import {
  dedupeInFlight,
  getCachedGeocode,
  setCachedGeocode,
  type GeocodeResult,
} from '@/modules/attendance/portal/geocodeCache';
import { reverseGeocode } from '@/utils/geoLocation';

export default withAuth(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!isValidLatLon({ lat, lon })) {
    return apiResponse.badRequest(res, 'lat and lon are required numeric query params');
  }

  // Cache hit (including a previously-cached null).
  const cached = getCachedGeocode(lat, lon);
  if (cached !== undefined) {
    return apiResponse.success(res, { geocode: cached, cached: true });
  }

  try {
    const data = await dedupeInFlight(lat, lon, async (): Promise<GeocodeResult | null> => {
      // reverseGeocode is tuned for SA (countrycodes=za), returns
      // { city, municipalDistrict, province }, and swallows upstream
      // errors into `null` itself. We just plumb the result through.
      return reverseGeocode(lat, lon);
    });
    setCachedGeocode(lat, lon, data);
    return apiResponse.success(res, { geocode: data, cached: false });
  } catch (err) {
    // reverseGeocode swallows upstream errors into null already, so this
    // is belt-and-braces. Cache the null to avoid a retry-storm on a
    // persistent failure and return a clean "nothing to show".
    log.warn('[geocode] unexpected error', {
      error: err instanceof Error ? err.message : String(err),
    });
    setCachedGeocode(lat, lon, null);
    return apiResponse.success(res, { geocode: null, cached: false });
  }
});
