/**
 * Nightly Cartrack GPS cross-check.
 *
 * For each recently-closed attendance_entry with a vehicle_assignment,
 * resolve the linked fleet_vehicle's cartrack_vehicle_id, fetch the
 * Cartrack position sample closest to clock_in_at and clock_out_at, and
 * upsert `attendance_gps_verifications` with the verdict:
 *
 *   match              — distance ≤ threshold_m
 *   mismatch           — distance > threshold_m (raises vehicle_gps_mismatch exception)
 *   no_data            — Cartrack returned no sample in ±5 min window
 *   vehicle_not_mapped — fleet_vehicles.cartrack_vehicle_id IS NULL or 404
 *   device_gps_off     — clock_in/out had no device lat/lon (phone GPS off);
 *                        Cartrack not called because corroboration is
 *                        impossible without a device side to compare to
 *
 * Framing: this is CORROBORATION, not fraud detection. Mismatch exceptions
 * are 'info' severity — a driver clocking in from their private car is
 * legitimate. Supervisors choose whether a mismatch warrants follow-up.
 *
 * Idempotence: UNIQUE (entry_id, check_type) on the verification table +
 * ON CONFLICT DO NOTHING means re-running for the same window is cheap
 * and safe.
 *
 * Split: SQL helpers live in cartrackReconcileQueries.ts to keep this
 * orchestrator under the 300-LOC cap.
 */

import { log } from '@/lib/logger';
import { haversineDistanceM } from '@/lib/geo';
import type { CartrackClient, CartrackFetchResult } from '@/services/tracking/cartrack/types';
import {
  loadCandidateEntries,
  upsertVerification,
  upsertMismatchAtomic,
  type CartrackCandidateEntry,
  type Verdict,
} from '@/services/attendance/cartrackReconcileQueries';

/**
 * 500m default threshold. Chosen empirically: covers a typical site-gate
 * to parking-bay distance (~100–300m), tolerates a bakkie parked across
 * the street, still flags cross-city discrepancies as actionable. There
 * is no BCEA guidance on geofence radius; the number is policy, not law.
 */
export const DEFAULT_MISMATCH_THRESHOLD_M = 500;

/**
 * Stop hitting Cartrack after this many consecutive transient failures
 * in a single run. Prevents a multi-day Cartrack outage from producing
 * per-entry-per-night retry storms. Counts only `network` / `http` 5xx
 * errors — expected outcomes like `vehicle_not_mapped` don't count.
 */
const CIRCUIT_BREAKER_LIMIT = 20;

export interface CartrackReconcileOptions {
  fromDate?: string; // YYYY-MM-DD SAST; default = yesterday
  toDate?: string;
  thresholdM?: number;
  toleranceMs?: number;
}

export interface CartrackReconcileReport {
  scannedFrom: string;
  scannedTo: string;
  entriesConsidered: number;
  rowsMatch: number;
  rowsMismatch: number;
  rowsNoData: number;
  rowsVehicleNotMapped: number;
  rowsDeviceGpsOff: number;
  rowsSkipped: number;
  mismatchExceptionsRaised: number;
  perEntryErrors: Array<{ entryId: string; error: string }>;
  /** Set when the circuit-breaker tripped; remaining entries weren't processed. */
  circuitBrokenAfter?: number;
  startedAt: string;
  finishedAt: string;
}

const SAST_TZ = 'Africa/Johannesburg';

function todayInSast(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SAST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseLatLon(lat: string | null, lon: string | null): { lat: number; lon: number } | null {
  if (lat == null || lon == null) return null;
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  return { lat: la, lon: lo };
}

async function reconcileOneSide(args: {
  entryId: string;
  checkType: 'in' | 'out';
  clockAt: Date;
  deviceCoords: { lat: number; lon: number } | null;
  vehicleCartrackId: string | null;
  cartrack: CartrackClient;
  thresholdM: number;
  toleranceMs: number;
  report: CartrackReconcileReport;
}): Promise<void> {
  if (!args.vehicleCartrackId) {
    const ok = await upsertVerification({
      entryId: args.entryId,
      checkType: args.checkType,
      verdict: 'vehicle_not_mapped',
      vehicleCartrackId: null,
      vehicleLat: null, vehicleLon: null, vehicleTs: null,
      deviceLat: args.deviceCoords?.lat ?? null,
      deviceLon: args.deviceCoords?.lon ?? null,
      distanceM: null,
      thresholdM: args.thresholdM,
    });
    if (ok) args.report.rowsVehicleNotMapped += 1;
    return;
  }

  // Device-GPS-off short-circuit. `parseLatLon` returning null means the
  // clock_*_lat/lon columns were NULL or non-finite — typically the
  // staff member clocked in with location services disabled. No amount
  // of Cartrack data can corroborate an absent device side, so skip the
  // HTTP call entirely and persist a distinct verdict so supervisors
  // can tell driver-GPS-off apart from Cartrack-silence (`no_data`).
  // Remediation paths differ: `device_gps_off` is a training / policy
  // issue; `no_data` is an ops / tenancy issue.
  if (!args.deviceCoords) {
    const ok = await upsertVerification({
      entryId: args.entryId,
      checkType: args.checkType,
      verdict: 'device_gps_off',
      vehicleCartrackId: args.vehicleCartrackId,
      vehicleLat: null, vehicleLon: null, vehicleTs: null,
      deviceLat: null, deviceLon: null,
      distanceM: null,
      thresholdM: args.thresholdM,
    });
    if (ok) args.report.rowsDeviceGpsOff += 1;
    return;
  }

  let fetchResult: CartrackFetchResult;
  try {
    fetchResult = await args.cartrack.fetchPositionAt(
      args.vehicleCartrackId,
      args.clockAt,
      args.toleranceMs
    );
  } catch (err) {
    args.report.perEntryErrors.push({
      entryId: args.entryId,
      error: err instanceof Error ? err.message : String(err),
    });
    log.error('[cartrack-reconcile] fetchPositionAt failed', {
      entryId: args.entryId,
      checkType: args.checkType,
      vehicleCartrackId: args.vehicleCartrackId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (fetchResult.status === 'vehicle_not_mapped') {
    const ok = await upsertVerification({
      entryId: args.entryId,
      checkType: args.checkType,
      verdict: 'vehicle_not_mapped',
      vehicleCartrackId: args.vehicleCartrackId,
      vehicleLat: null, vehicleLon: null, vehicleTs: null,
      deviceLat: args.deviceCoords?.lat ?? null,
      deviceLon: args.deviceCoords?.lon ?? null,
      distanceM: null,
      thresholdM: args.thresholdM,
    });
    if (ok) args.report.rowsVehicleNotMapped += 1;
    return;
  }

  if (fetchResult.status === 'no_data') {
    const ok = await upsertVerification({
      entryId: args.entryId,
      checkType: args.checkType,
      verdict: 'no_data',
      vehicleCartrackId: args.vehicleCartrackId,
      vehicleLat: null, vehicleLon: null, vehicleTs: null,
      deviceLat: args.deviceCoords?.lat ?? null,
      deviceLon: args.deviceCoords?.lon ?? null,
      distanceM: null,
      thresholdM: args.thresholdM,
    });
    if (ok) args.report.rowsNoData += 1;
    return;
  }

  // Unreachable: the device-GPS-off short-circuit above would have
  // returned already if deviceCoords were null. Narrow the type for
  // TypeScript and throw if we ever reach here via a refactor that
  // bypasses the short-circuit.
  if (!args.deviceCoords) {
    throw new Error(
      '[cartrack-reconcile] invariant broken: deviceCoords null after device_gps_off short-circuit'
    );
  }

  const distanceM = haversineDistanceM(args.deviceCoords, {
    lat: fetchResult.sample.lat,
    lon: fetchResult.sample.lon,
  });
  const distanceRounded = Math.round(distanceM * 100) / 100;
  const verdict: Verdict = distanceM <= args.thresholdM ? 'match' : 'mismatch';

  if (verdict === 'match') {
    const inserted = await upsertVerification({
      entryId: args.entryId,
      checkType: args.checkType,
      verdict: 'match',
      vehicleCartrackId: args.vehicleCartrackId,
      vehicleLat: fetchResult.sample.lat,
      vehicleLon: fetchResult.sample.lon,
      vehicleTs: fetchResult.sample.ts,
      deviceLat: args.deviceCoords.lat,
      deviceLon: args.deviceCoords.lon,
      distanceM: distanceRounded,
      thresholdM: args.thresholdM,
    });
    if (inserted) args.report.rowsMatch += 1;
    else args.report.rowsSkipped += 1;
    return;
  }

  // Mismatch path: write the verification AND the supervisor-visible
  // exception atomically. Previously these were two separate writes; if
  // the exception insert threw after the verification committed, the
  // mismatch lived in the DB but was invisible to supervisors, and the
  // next cron run short-circuited on the existing verification row.
  try {
    const result = await upsertMismatchAtomic({
      entryId: args.entryId,
      checkType: args.checkType,
      vehicleCartrackId: args.vehicleCartrackId,
      vehicleLat: fetchResult.sample.lat,
      vehicleLon: fetchResult.sample.lon,
      vehicleTs: fetchResult.sample.ts,
      deviceLat: args.deviceCoords.lat,
      deviceLon: args.deviceCoords.lon,
      distanceM: distanceRounded,
      thresholdM: args.thresholdM,
    });
    if (!result.verificationInserted) {
      args.report.rowsSkipped += 1;
      return;
    }
    args.report.rowsMismatch += 1;
    if (result.exceptionInserted) args.report.mismatchExceptionsRaised += 1;
  } catch (err) {
    // Transaction rolled back entirely — neither verification nor
    // exception persisted. Record the error; next run retries from scratch.
    args.report.perEntryErrors.push({
      entryId: args.entryId,
      error: err instanceof Error ? err.message : String(err),
    });
    log.error('[cartrack-reconcile] mismatch transaction failed — next run will retry', {
      entryId: args.entryId,
      checkType: args.checkType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function reconcileEntry(
  e: CartrackCandidateEntry,
  cartrack: CartrackClient,
  thresholdM: number,
  toleranceMs: number,
  report: CartrackReconcileReport
): Promise<void> {
  if (!e.has_in_verification) {
    await reconcileOneSide({
      entryId: e.id,
      checkType: 'in',
      clockAt: new Date(e.clock_in_at),
      deviceCoords: parseLatLon(e.clock_in_lat, e.clock_in_lon),
      vehicleCartrackId: e.cartrack_vehicle_id,
      cartrack, thresholdM, toleranceMs, report,
    });
  }
  if (!e.has_out_verification && e.clock_out_at) {
    await reconcileOneSide({
      entryId: e.id,
      checkType: 'out',
      clockAt: new Date(e.clock_out_at),
      deviceCoords: parseLatLon(e.clock_out_lat, e.clock_out_lon),
      vehicleCartrackId: e.cartrack_vehicle_id,
      cartrack, thresholdM, toleranceMs, report,
    });
  }
}

export async function cartrackReconcile(
  cartrack: CartrackClient,
  options: CartrackReconcileOptions = {}
): Promise<CartrackReconcileReport> {
  const startedAt = new Date();
  const today = todayInSast();
  const toDate = options.toDate ?? addDays(today, -1);
  const fromDate = options.fromDate ?? toDate;
  const thresholdM = options.thresholdM ?? DEFAULT_MISMATCH_THRESHOLD_M;
  const toleranceMs = options.toleranceMs ?? 5 * 60 * 1000;

  if (fromDate > toDate) {
    throw new Error(`cartrackReconcile: fromDate (${fromDate}) > toDate (${toDate})`);
  }

  const report: CartrackReconcileReport = {
    scannedFrom: fromDate,
    scannedTo: toDate,
    entriesConsidered: 0,
    rowsMatch: 0,
    rowsMismatch: 0,
    rowsNoData: 0,
    rowsVehicleNotMapped: 0,
    rowsDeviceGpsOff: 0,
    rowsSkipped: 0,
    mismatchExceptionsRaised: 0,
    perEntryErrors: [],
    startedAt: startedAt.toISOString(),
    finishedAt: '',
  };

  const entries = await loadCandidateEntries(fromDate, toDate);
  report.entriesConsidered = entries.length;
  const breaker = { consecutiveFailures: 0 };
  for (const e of entries) {
    const errorsBefore = report.perEntryErrors.length;
    await reconcileEntry(e, cartrack, thresholdM, toleranceMs, report);
    const errorsAfter = report.perEntryErrors.length;
    if (errorsAfter > errorsBefore) {
      breaker.consecutiveFailures += errorsAfter - errorsBefore;
    } else {
      breaker.consecutiveFailures = 0;
    }
    if (breaker.consecutiveFailures >= CIRCUIT_BREAKER_LIMIT) {
      report.circuitBrokenAfter = report.perEntryErrors.length;
      log.error(
        '[cartrack-reconcile] circuit-breaker tripped — too many consecutive Cartrack errors',
        {
          consecutiveFailures: breaker.consecutiveFailures,
          limit: CIRCUIT_BREAKER_LIMIT,
          scannedFrom: fromDate,
          scannedTo: toDate,
        }
      );
      break;
    }
  }

  report.finishedAt = new Date().toISOString();
  return report;
}
