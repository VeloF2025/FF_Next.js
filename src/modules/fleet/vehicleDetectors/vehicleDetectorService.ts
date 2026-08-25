/**
 * The vehicle telematics detector phase.
 *
 * Runs every detector over every actively-tracked vehicle for one tick and
 * hands what they saw to the EXISTING incident producer. It creates nothing
 * itself: dedup, recurrence and the observation fingerprint all come free from
 * `produceIncident`'s `source_event` path, which returns `unchanged` when a
 * `sourceEventId` has been seen before. That is why `sourceEventId.ts` is the
 * load-bearing file in this slice and this one is orchestration.
 *
 * ## Isolation, at three levels
 *
 * A telematics feed is a third party and the detectors are new; neither may be
 * able to take down the roster monitor this phase shares a cron tick with.
 *
 *   per detector   one throwing detector does not stop the others for that
 *                  vehicle, and marks the phase `partial`.
 *   per vehicle    one vehicle's failed load does not stop the fleet.
 *   per event      one refused producer call (a missing incident rule, say)
 *                  does not discard the other events of the same tick.
 *
 * The phase's own failure is reported in its counters, never by throwing —
 * `pages/api/cron/fleet-operational-monitor.ts` runs it AFTER
 * `runOperationalMonitor` under the same lock, and a detector fault must not
 * mark the roster monitor's run failed.
 *
 * ## Why every detector reads a fresh window every tick
 *
 * There is no watermark here, deliberately. A watermark makes sense for a
 * builder whose output is a row per day; these detectors ask "is this condition
 * TRUE NOW", and re-asking over an overlapping window is exactly how a
 * still-present condition stays one incident. The window is sized so a stop or
 * an after-hours run cannot fall out of it mid-condition.
 */

import { log } from '@/lib/logger';
import { produceIncident } from '../incidents/incidentProducer';
import type { IncidentType, SanitizedIncidentMetadata } from '../incidents/types';
import { accidentSosDetector } from './accidentSosDetector';
import {
  loadDetectorVehicles, loadGapP90Seconds, loadLastPosition, loadPositionWindow,
} from './detectorQueries';
import { loadHolidays } from './holidayQueries';
import { lostContactDetector } from './lostContactDetector';
import { severeDrivingDetector } from './severeDrivingDetector';
import { theftDetector } from './theftDetector';
import { unauthorizedStopDetector } from './unauthorizedStopDetector';
import { loadEffectiveVehicleRule } from './vehicleRuleQueries';
import { resolveVehicleProjectId } from './vehicleProjectResolver';
import type {
  DetectedVehicleEvent, VehicleDetector, VehicleDetectorContext, VehicleOperationalRule,
} from './types';

const MODULE = 'FleetVehicleDetectors';

/**
 * How far back each tick looks.
 *
 * Long enough that the longest condition a detector tracks cannot start outside
 * it while still being true inside it: a 45-minute stop, an after-hours window
 * that runs 18:00→06:00, and a theft anchor that must stay loaded for the whole
 * night. Twelve hours covers all three with room, and bounds the read.
 */
export const WINDOW_HOURS = 12;

/** The cadence sample `lost_contact_moving` scales itself by. */
export const CADENCE_SAMPLE_HOURS = 24;

/**
 * Ceiling on positions loaded per vehicle per tick.
 *
 * `cartrack/velocity` reports ~1,169 fixes/vehicle-day (max 3,047), so 12 hours
 * is ~600 fixes typically and ~1,600 at the observed maximum. 6,000 is roughly
 * 4x the worst measured case: a ceiling against a backfill, not a page size.
 */
export const MAX_POSITIONS_PER_VEHICLE = 6_000;

/** One detector as the phase registers it: its id, the incident type it opens, and the run. */
export interface RegisteredDetector {
  id: string;
  incidentType: IncidentType;
  run: VehicleDetector;
}

/**
 * `dangerous_area_entry` is absent because there is no dangerous-area geofence
 * table in this database. It is DEFERRED, not stubbed: its incident rule row
 * stays exactly as migration 529 leaves it and no code path references it.
 */
const DETECTORS: readonly RegisteredDetector[] = [
  { id: 'theft_after_hours_movement', incidentType: 'theft_after_hours_movement', run: theftDetector },
  { id: 'severe_driving', incidentType: 'severe_driving', run: severeDrivingDetector },
  { id: 'prolonged_unauthorized_stop', incidentType: 'prolonged_unauthorized_stop', run: unauthorizedStopDetector },
  { id: 'lost_contact_moving', incidentType: 'lost_contact_moving', run: lostContactDetector },
  { id: 'accident_sos', incidentType: 'accident_sos', run: accidentSosDetector },
];

export type VehicleDetectorPhaseStatus = 'succeeded' | 'partial' | 'failed' | 'skipped';

export interface VehicleDetectorPhaseResult {
  status: VehicleDetectorPhaseStatus;
  vehiclesEvaluated: number;
  eventsDetected: number;
  incidentsOpened: number;
  incidentsUnchanged: number;
  detectorFailures: number;
  producerFailures: number;
}

/** Seams, so the phase can be exercised without a database. Production passes none of them. */
export interface VehicleDetectorDeps {
  loadVehicles: typeof loadDetectorVehicles;
  loadWindow: typeof loadPositionWindow;
  loadLast: typeof loadLastPosition;
  loadGapP90: typeof loadGapP90Seconds;
  loadRule: (asOf: string) => Promise<VehicleOperationalRule | null>;
  loadHolidayDates: (from: string, to: string) => Promise<ReadonlySet<string>>;
  resolveProjectId: (lat: number | null, lon: number | null) => Promise<string | null>;
  produce: typeof produceIncident;
  detectors: readonly RegisteredDetector[];
}

const DEFAULT_DEPS: VehicleDetectorDeps = {
  loadVehicles: loadDetectorVehicles,
  loadWindow: loadPositionWindow,
  loadLast: loadLastPosition,
  loadGapP90: loadGapP90Seconds,
  loadRule: loadEffectiveVehicleRule,
  loadHolidayDates: loadHolidays,
  resolveProjectId: (lat, lon) => resolveVehicleProjectId(lat, lon),
  produce: produceIncident,
  detectors: DETECTORS,
};

function hoursBefore(nowIso: string, hours: number): string {
  return new Date(Date.parse(nowIso) - hours * 3_600_000).toISOString();
}

/**
 * The holiday window the after-hours calendar needs.
 *
 * Deliberately a day wider than the detection window at BOTH ends. The dates
 * here are UTC, the holidays are SAST calendar days, and 22:00 UTC is already
 * tomorrow in Johannesburg — a range trimmed to exactly the window would drop
 * the holiday on the very night the after-hours rule most needs it. Two extra
 * dates cost one row each.
 */
function holidayRange(nowIso: string): { from: string; to: string } {
  return { from: hoursBefore(nowIso, 48).slice(0, 10), to: hoursBefore(nowIso, -24).slice(0, 10) };
}

function emptyResult(status: VehicleDetectorPhaseStatus): VehicleDetectorPhaseResult {
  return {
    status, vehiclesEvaluated: 0, eventsDetected: 0, incidentsOpened: 0,
    incidentsUnchanged: 0, detectorFailures: 0, producerFailures: 0,
  };
}

/**
 * `metadata` must be flat primitives — `SanitizedIncidentMetadata`. A nested
 * object reaches `evidence_snapshot` as something no reader can render, and
 * TypeScript alone does not catch it once a detector builds metadata
 * dynamically, so this drops any non-primitive rather than storing it.
 */
export function sanitizeMetadata(metadata: SanitizedIncidentMetadata): SanitizedIncidentMetadata {
  const clean: SanitizedIncidentMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      clean[key] = value;
      continue;
    }
    log.warn('[fleet-detectors] dropped a non-primitive metadata field', { key }, MODULE);
  }
  return clean;
}

async function produceOne(
  detector: RegisteredDetector, event: DetectedVehicleEvent, vehicleId: string,
  deps: VehicleDetectorDeps, result: VehicleDetectorPhaseResult,
): Promise<void> {
  try {
    const projectId = await deps.resolveProjectId(event.lat, event.lon);
    const outcome = await deps.produce({
      producerKind: 'source_event',
      incidentType: detector.incidentType,
      sourceEventId: event.sourceEventId,
      occurredAt: event.occurredAt,
      // Never a staff id. These detectors observe a VEHICLE; the producer's
      // scheduled path is the one that requires a staff identity, and handing it
      // one here would attribute a machine reading to a person.
      staffId: null,
      vehicleId,
      projectId,
      metadata: sanitizeMetadata(event.metadata),
    });
    if (outcome.outcome === 'opened') result.incidentsOpened += 1;
    else result.incidentsUnchanged += 1;
  } catch (error) {
    result.producerFailures += 1;
    log.error(
      '[fleet-detectors] producing an incident failed',
      { detector: detector.id, vehicleId, error: error instanceof Error ? error.message : String(error) },
      MODULE,
    );
  }
}

async function runForVehicle(
  ctx: VehicleDetectorContext, deps: VehicleDetectorDeps, result: VehicleDetectorPhaseResult,
): Promise<void> {
  for (const detector of deps.detectors) {
    let events: DetectedVehicleEvent[];
    try {
      events = await detector.run(ctx);
    } catch (error) {
      result.detectorFailures += 1;
      log.error(
        '[fleet-detectors] detector threw; continuing with the rest',
        {
          detector: detector.id, vehicleId: ctx.vehicle.vehicleId,
          error: error instanceof Error ? error.message : String(error),
        },
        MODULE,
      );
      continue;
    }
    result.eventsDetected += events.length;
    for (const event of events) {
      await produceOne(detector, event, ctx.vehicle.vehicleId, deps, result);
    }
  }
}

export interface VehicleDetectorPhaseRequest {
  /** The tick instant. Passed in rather than read here so the phase has no clock. */
  now: string;
}

export async function runVehicleDetectors(
  request: VehicleDetectorPhaseRequest, overrides: Partial<VehicleDetectorDeps> = {},
): Promise<VehicleDetectorPhaseResult> {
  const deps: VehicleDetectorDeps = { ...DEFAULT_DEPS, ...overrides };
  const rule = await deps.loadRule(request.now);
  if (!rule) {
    // Not an exception: with no effective rule there are no thresholds, and
    // inventing defaults here would put a WhatsApp-bearing detector on numbers
    // nobody versioned.
    log.error('[fleet-detectors] no effective vehicle operational rule; phase skipped', undefined, MODULE);
    return emptyResult('failed');
  }

  const vehicles = await deps.loadVehicles();
  if (vehicles.length === 0) return emptyResult('skipped');

  const range = holidayRange(request.now);
  const holidays = await deps.loadHolidayDates(range.from, range.to);
  const windowFrom = hoursBefore(request.now, WINDOW_HOURS);
  const cadenceFrom = hoursBefore(request.now, CADENCE_SAMPLE_HOURS);

  const result = emptyResult('succeeded');
  let vehicleFailures = 0;

  for (const vehicle of vehicles) {
    try {
      const [positions, lastPosition, gapP90Seconds] = await Promise.all([
        deps.loadWindow(vehicle.vehicleId, windowFrom, MAX_POSITIONS_PER_VEHICLE),
        deps.loadLast(vehicle.vehicleId),
        deps.loadGapP90(vehicle.vehicleId, cadenceFrom),
      ]);
      result.vehiclesEvaluated += 1;
      await runForVehicle(
        { vehicle, positions, lastPosition, gapP90Seconds, rule, holidays, now: request.now },
        deps, result,
      );
    } catch (error) {
      vehicleFailures += 1;
      log.error(
        '[fleet-detectors] loading a vehicle failed; continuing with the fleet',
        { vehicleId: vehicle.vehicleId, error: error instanceof Error ? error.message : String(error) },
        MODULE,
      );
    }
  }

  if (result.detectorFailures > 0 || result.producerFailures > 0 || vehicleFailures > 0) {
    result.status = result.vehiclesEvaluated === 0 ? 'failed' : 'partial';
  }
  return result;
}
