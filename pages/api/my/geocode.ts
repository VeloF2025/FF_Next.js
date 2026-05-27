/**
 * GET /api/my/geocode?lat=<number>&lon=<number>
 *
 * Server-side proxy for reverse-geocoding staff clock-in/out
 * coordinates to a human-readable SA address. Staff browsers call us
 * (same origin, no CSP update needed), and we call Nominatim on the
 * server side with a TTL cache + in-flight dedupe. That keeps the
 * OpenStreetMap free-tier happy (1 req/s, usage-policy-friendly UA)
 * even when 50 staff clock in simultaneously, and keeps staff IPs
 * out of OpenStreetMap's logs (POPIA).
 *
 * Response shape is always 200 + `{ geocode: GeocodeResult | null }`:
 *   - Resolved successfully → geocode is the structured address.
 *   - Nominatim down, rate-limited, or returned no useful data → null.
 * Either way, the caller renders gracefully; clock-in never depends
 * on this endpoint's success.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { isValidLatLon } from '@/lib/geo';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import {
  dedupeInFlight,
  getCachedGeocode,
  setCachedGeocode,
  type GeocodeResult,
} from '@/modules/attendance/portal/geocodeCache';
import { reverseGeocode } from '@/utils/geoLocation';

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!isValidLatLon({ lat, lon })) {
    return apiResponse.badRequest(res, 'lat and lon are required numeric query params');
  }

  // Cache hit (including a previously-cached null). Record the hit in
  // the app logger for debugging but don't write stderr — hot path.
  const cached = getCachedGeocode(lat, lon);
  if (cached !== undefined) {
    return apiResponse.success(res, { geocode: cached, cached: true });
  }

  try {
    const data = await dedupeInFlight(lat, lon, async (): Promise<GeocodeResult | null> => {
      // reverseGeocode is already tuned for SA (countrycodes=za),
      // returns {city, municipalDistrict, province}, and itself
      // swallows errors into `null`. We just plumb the result through.
      return reverseGeocode(lat, lon);
    });
    setCachedGeocode(lat, lon, data);
    return apiResponse.success(res, { geocode: data, cached: false });
  } catch (err) {
    // Shouldn't happen — reverseGeocode swallows upstream errors into
    // null already. Belt-and-braces: treat any surprise as a clean
    // "nothing to show", cache the null so we don't retry-storm on a
    // persistent failure, mirror to stderr so ops see a repeat pattern.
    log.warn('[my-geocode] unexpected error', {
      staffId: session.staffId,
      error: err instanceof Error ? err.message : String(err),
    });
    process.stderr.write(
      JSON.stringify({
        level: 'WARN',
        component: 'attendance-geocode',
        event: 'upstream_error',
        staffId: session.staffId,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      }) + '\n'
    );
    setCachedGeocode(lat, lon, null);
    return apiResponse.success(res, { geocode: null, cached: false });
  }
});
