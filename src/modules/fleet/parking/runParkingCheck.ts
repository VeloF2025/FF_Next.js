/**
 * Orchestrates the nightly overnight-parking check.
 *
 * Per-vehicle evaluation is independent: one malformed row or one failed
 * insert must not cost us the other twenty-one results, so each vehicle
 * is wrapped individually and failures are counted rather than thrown.
 *
 * Invariant: sum(counts) + errors === evaluated
 * Only rows that are successfully written are counted in `counts`.
 *
 * No advisory lock is taken. The unique index on
 * (vehicle_id, check_date) already makes concurrent or repeated runs
 * converge on the same single row per vehicle per day, so a lock would
 * add a failure mode without removing one.
 */
import { log } from '@/lib/logger';
import { classifyParkingCompliance } from './classifyParkingCompliance';
import { insertComplianceCheck, loadParkingCheckCandidates } from './parkingQueries';
import type { ParkingCheckResult } from './types';

/** Per-vehicle outcome, for callers (e.g. later violation notifications) that need more than the aggregate counts. Only present for vehicles whose insert succeeded. */
export interface ParkingCheckVehicleResult {
  vehicleId: string;
  registration: string;
  result: ParkingCheckResult;
  distanceM: number | null;
  lastFixAgeSeconds: number | null;
  /** True when this was a new row for the day, false when it overwrote an earlier run's row (see insertComplianceCheck). */
  inserted: boolean;
}

export interface ParkingCheckReport {
  checkDate: string;
  evaluated: number;
  counts: Record<ParkingCheckResult, number>;
  errors: number;
  results: ParkingCheckVehicleResult[];
}

/**
 * The SAST calendar date for an instant. The server runs in
 * Africa/Johannesburg today, but deriving the date explicitly means a
 * future host in another zone cannot silently shift every check_date.
 * `en-CA` is used because it formats as YYYY-MM-DD.
 */
export function sastDateString(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

function emptyCounts(): Record<ParkingCheckResult, number> {
  return { compliant: 0, violation: 0, unknown: 0, not_verifiable: 0, no_address: 0 };
}

export async function runParkingCheck(checkAt: Date): Promise<ParkingCheckReport> {
  const checkDate = sastDateString(checkAt);
  const candidates = await loadParkingCheckCandidates(checkAt);

  const report: ParkingCheckReport = {
    checkDate,
    evaluated: candidates.length,
    counts: emptyCounts(),
    errors: 0,
    results: [],
  };

  for (const c of candidates) {
    try {
      const outcome = classifyParkingCompliance({
        location: c.location,
        hasTracker: c.hasTracker,
        lastFix: c.lastFix,
        checkAt,
      });

      const inserted = await insertComplianceCheck({
        vehicleId: c.vehicleId,
        checkDate,
        evaluatedAt: checkAt,
        parkingLocationId: c.location?.id ?? null,
        lastFixAt: c.lastFix?.recordedAt ?? null,
        lastFixLat: c.lastFix?.lat ?? null,
        lastFixLon: c.lastFix?.lon ?? null,
        lastFixAgeSeconds: outcome.lastFixAgeSeconds,
        distanceM: outcome.distanceM,
        result: outcome.result,
      });
      report.counts[outcome.result] += 1;
      report.results.push({
        vehicleId: c.vehicleId,
        registration: c.registration,
        result: outcome.result,
        distanceM: outcome.distanceM,
        lastFixAgeSeconds: outcome.lastFixAgeSeconds,
        inserted,
      });
    } catch (error) {
      report.errors += 1;
      log.error('[fleet-parking-check] failed to record result', {
        vehicleId: c.vehicleId,
        registration: c.registration,
        checkDate,
        error,
      });
    }
  }

  return report;
}
