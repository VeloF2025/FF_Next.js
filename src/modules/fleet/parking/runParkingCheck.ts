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
import { sastDateString } from './sastDate';
import type { ParkingCheckReport, ParkingCheckResult } from './types';

export { sastDateString } from './sastDate';
export type {
  ParkingCheckReport,
  ParkingCheckVehicleResult,
} from './types';

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

      const write = await insertComplianceCheck({
        vehicleId: c.vehicleId,
        registration: c.registration,
        checkDate,
        evaluatedAt: checkAt,
        // `no_address` is exactly the branch where the classifier refused the
        // declared location — either it is missing or its coordinates are out
        // of range. Attributing the row to it anyway produces the contradiction
        // "no address on file" next to a link to the address it was checked
        // against, in the drill-in a disputed violation is settled from.
        parkingLocationId: outcome.result === 'no_address' ? null : (c.location?.id ?? null),
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
        inserted: write.inserted,
        previousResult: write.previousResult,
        newViolation: outcome.result === 'violation' && write.previousResult !== 'violation',
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
