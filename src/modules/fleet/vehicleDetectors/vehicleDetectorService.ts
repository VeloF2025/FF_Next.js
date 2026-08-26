/**
 * The vehicle telematics detector phase.
 *
 * Runs every detector over every actively-tracked vehicle for one tick and
 * hands what they saw to the EXISTING incident producer. It creates nothing
 * itself: DEDUP and the observation fingerprint come free from
 * `produceIncident`'s `source_event` path, which returns `unchanged` when a
 * `sourceEventId` has been seen before. That is why `sourceEventId.ts` is the
 * load-bearing file in this slice and this one is orchestration.
 *
 * RECURRENCE does NOT come free, and the difference matters. The scheduled path
 * calls `touchIncidentLastSeen` and appends an observation when it sees a
 * condition again; the source-event path returns `unchanged` and touches
 * nothing, so `condition_last_seen_at` stays at the open instant and a vehicle
 * still stopped in the same place three hours later looks, to the queue, exactly
 * like one that stopped once. Known limitation, deliberately not fixed here:
 * "still true" for a bucketed source event is a different question from "seen
 * again" for a roster detection, and answering it needs its own slice.
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
 * ## An opened incident is NOTIFIED here, not left to escalate into one
 *
 * `produceIncident` deliberately never notifies — delivery happens after its
 * transaction commits, and `requiresInitialNotification` is how it says so.
 * Without the call below a new telematics incident would be SILENT until the
 * action runner escalated it, which for a critical type means the first thing
 * anyone hears is an escalation WhatsApp minutes later — guaranteed, because
 * nobody knew there was anything to acknowledge. So this phase does exactly
 * what `monitorService` does on `opened`: resolve the incident rule, call
 * `sendIncidentOpenedNotification`, and count the delivery. The mandatory
 * WhatsApp leg then fires once, on open, for the two types 529 leaves
 * `critical` — which is the designed behaviour, not a side effect.
 *
 * The incident rule is loaded for a second reason: `enabled` and
 * `createsIncident`. The producer's source-event path reads a rule only for its
 * severity, so without this check disabling `severe_driving` would do nothing.
 *
 * ## No watermark, deliberately
 *
 * A watermark suits a builder whose output is a row per day; these detectors ask
 * "is this condition TRUE NOW", and re-asking over an overlapping window is
 * exactly how a still-present condition stays one incident.
 */

import { log } from '@/lib/logger';
import { produceIncident } from '../incidents/incidentProducer';
import { sendIncidentOpenedNotification } from '../incidents/incidentNotifications';
import { loadEffectiveIncidentRule } from '../incidents/settingsRepository';
import type { IncidentRule, IncidentType } from '../incidents/types';
import {
  emitDetectedEvent, loadIncidentRules, type EmitterDeps, type RegisteredDetector,
} from './detectedEventEmitter';
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
  DetectedVehicleEvent, VehicleDetectorContext, VehicleOperationalRule,
} from './types';

const MODULE = 'FleetVehicleDetectors';

/**
 * How far back each tick looks.
 *
 * Long enough that the longest condition a detector tracks cannot start outside
 * it while still being true inside it: a 45-minute stop, the seeded after-hours
 * window of 21:00→05:00 (eight hours, per migration 529 as shipped), and a theft
 * anchor that must stay loaded for the whole night. Twelve hours covers all
 * three with room, and bounds the read.
 *
 * KNOWN AND ACCEPTED under-detection: a weekend or public holiday is one
 * after-hours BUCKET of up to 24 hours (`weekends_are_after_hours`), which is
 * wider than this 12-hour load. A vehicle whose Saturday displacement only
 * exceeds the threshold more than 12 hours after that bucket's first loaded fix
 * measures its displacement from a later anchor and can therefore under-report.
 * It fails in the quiet direction — a missed alert, never a false one — and
 * widening the load to 24 h would double the per-tick read for all eighteen
 * vehicles to fix a case no dry-run day exhibited. Revisit if one does.
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
  /** Suppressed because their incident rule is disabled or set not to create incidents. */
  incidentsSuppressedByRule: number;
  notificationsAccepted: number;
  notificationsFailed: number;
  detectorFailures: number;
  producerFailures: number;
}

/** Seams, so the phase can be exercised without a database. Production passes none of them. */
export interface VehicleDetectorDeps extends EmitterDeps {
  loadVehicles: typeof loadDetectorVehicles;
  loadWindow: typeof loadPositionWindow;
  loadLast: typeof loadLastPosition;
  loadGapP90: typeof loadGapP90Seconds;
  loadRule: (asOf: string) => Promise<VehicleOperationalRule | null>;
  loadHolidayDates: (from: string, to: string) => Promise<ReadonlySet<string>>;
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
  loadIncidentRule: loadEffectiveIncidentRule,
  produce: produceIncident,
  notifyOpened: sendIncidentOpenedNotification,
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

/**
 * A zeroed result. Exported as `vehicleDetectorPhaseFailure` so the cron route
 * cannot drift from this shape — it built its own literal once, and adding a
 * counter broke the build rather than the route only because tsc caught it.
 */
function emptyResult(status: VehicleDetectorPhaseStatus): VehicleDetectorPhaseResult {
  return {
    status, vehiclesEvaluated: 0, eventsDetected: 0, incidentsOpened: 0,
    incidentsUnchanged: 0, incidentsSuppressedByRule: 0, notificationsAccepted: 0,
    notificationsFailed: 0, detectorFailures: 0, producerFailures: 0,
  };
}

async function runForVehicle(
  ctx: VehicleDetectorContext, rules: Map<IncidentType, IncidentRule>,
  deps: VehicleDetectorDeps, result: VehicleDetectorPhaseResult,
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
    if (events.length === 0) continue;

    // Configured off is not an error — it is an operator's decision, and the
    // producer's source-event path would otherwise honour only the severity.
    const rule = rules.get(detector.incidentType);
    if (!rule || !rule.enabled || !rule.createsIncident) {
      result.incidentsSuppressedByRule += events.length;
      continue;
    }
    for (const event of events) {
      await emitDetectedEvent(detector, event, ctx.vehicle, rule, deps, result);
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

  const incidentRules = await loadIncidentRules(deps, request.now);
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
        incidentRules, deps, result,
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

/** The result the cron route reports when the phase could not even run. */
export function vehicleDetectorPhaseFailure(): VehicleDetectorPhaseResult {
  return emptyResult('failed');
}
