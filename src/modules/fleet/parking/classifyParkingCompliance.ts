/**
 * Pure decision logic for the nightly overnight-parking check.
 *
 * Extracted from the job so every branch is testable without a database,
 * mirroring how `liveMapHelpers.ts` was split out of `FleetMap`.
 *
 * Precedence is deliberate and must not be reordered:
 *   no_address > not_verifiable > unknown > compliant/violation
 * A missing address is the driver's problem and outranks a missing
 * tracker, which is a hardware problem — they need different people.
 */
import { haversineDistanceM, isValidLatLon } from '@/lib/geo';
import type { ClassifyInput, ClassifyOutput } from './types';

/**
 * A fix older than this cannot be treated as authoritative evidence of
 * where a vehicle is. 72 hours lets a vehicle parked across a standard
 * weekend (Friday 17:00 to Sunday 20:00 is ~51 hours) classify normally,
 * while a tracker silent longer than a long weekend stops being trusted.
 *
 * Expected to need tuning once real data accumulates — see spec 5.1.
 */
export const STALE_FIX_MAX_HOURS = 72;

export function classifyParkingCompliance(input: ClassifyInput): ClassifyOutput {
  const { location, hasTracker, lastFix, checkAt } = input;

  if (!location || !isValidLatLon({ lat: location.lat, lon: location.lon })) {
    return { result: 'no_address', distanceM: null, lastFixAgeSeconds: null };
  }

  if (!hasTracker) {
    return { result: 'not_verifiable', distanceM: null, lastFixAgeSeconds: null };
  }

  if (!lastFix || !isValidLatLon({ lat: lastFix.lat, lon: lastFix.lon })) {
    return { result: 'unknown', distanceM: null, lastFixAgeSeconds: null };
  }

  // Clamp at zero: a tracker clock running ahead of the server must not
  // yield a negative age that trivially passes the staleness check.
  const ageSeconds = Math.max(
    0,
    Math.round((checkAt.getTime() - lastFix.recordedAt.getTime()) / 1000)
  );

  const distanceM = Math.round(
    haversineDistanceM(
      { lat: lastFix.lat, lon: lastFix.lon },
      { lat: location.lat, lon: location.lon }
    )
  );

  // Distance is reported even when the verdict is `unknown`: "last seen
  // 40 km away, four days ago" is exactly the evidence an operator needs.
  if (ageSeconds > STALE_FIX_MAX_HOURS * 3600) {
    return { result: 'unknown', distanceM, lastFixAgeSeconds: ageSeconds };
  }

  return {
    result: distanceM <= location.radiusM ? 'compliant' : 'violation',
    distanceM,
    lastFixAgeSeconds: ageSeconds,
  };
}
