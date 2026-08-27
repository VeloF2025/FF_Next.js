/**
 * Turning one detected event into one incident, and telling someone.
 *
 * Split from `vehicleDetectorService` because it is a different job with a
 * different failure mode: the service decides WHICH detectors run over WHICH
 * vehicles, this decides what the producer and the notifier are handed. Both
 * halves stayed under one roof until the notification leg landed and the file
 * passed 300 lines — the seam was already there.
 *
 * Nothing here throws at its caller. A refused producer call and a failed
 * delivery are both counted, because one bad event must not discard the rest of
 * a tick.
 */

import { log } from '@/lib/logger';
import type { produceIncident } from '../incidents/incidentProducer';
import type { sendIncidentOpenedNotification } from '../incidents/incidentNotifications';
import type { IncidentRule, IncidentType, SanitizedIncidentMetadata } from '../incidents/types';
import type { VehicleDriver } from './vehicleDriverResolver';
import type { DetectedVehicleEvent, DetectorVehicle, VehicleDetector } from './types';

const MODULE = 'FleetVehicleDetectors';

/** One detector as the phase registers it: its id, the incident type it opens, and the run. */
export interface RegisteredDetector {
  id: string;
  incidentType: IncidentType;
  run: VehicleDetector;
}

/** What emitting an event needs. `VehicleDetectorDeps` extends this. */
export interface EmitterDeps {
  resolveProjectId: (lat: number | null, lon: number | null) => Promise<string | null>;
  /** The vehicle's driver at the event instant, or null when no assignment covers it. Never throws — see `vehicleDriverResolver`. */
  resolveDriver: (vehicleId: string, occurredAt: string) => Promise<VehicleDriver | null>;
  loadIncidentRule: (incidentType: IncidentType, asOf: string) => Promise<IncidentRule | null>;
  produce: typeof produceIncident;
  notifyOpened: typeof sendIncidentOpenedNotification;
}

/** The counters this module writes into. Owned by the phase result. */
export interface EmitCounters {
  incidentsOpened: number;
  incidentsUnchanged: number;
  notificationsAccepted: number;
  notificationsFailed: number;
  producerFailures: number;
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

export async function emitDetectedEvent(
  detector: RegisteredDetector, event: DetectedVehicleEvent, vehicle: DetectorVehicle,
  rule: IncidentRule, deps: EmitterDeps, result: EmitCounters,
): Promise<void> {
  try {
    const [projectId, driver] = await Promise.all([
      deps.resolveProjectId(event.lat, event.lon),
      deps.resolveDriver(vehicle.vehicleId, event.occurredAt),
    ]);
    const outcome = await deps.produce({
      producerKind: 'source_event',
      incidentType: detector.incidentType,
      sourceEventId: event.sourceEventId,
      occurredAt: event.occurredAt,
      // The driver `vehicle_assignments` says held this vehicle at the event
      // instant, or null when none did — which is what every vehicle incident
      // carried before attribution existed. This stays the SOURCE-EVENT path:
      // `producerKind` alone decides which producer branch runs, so a staff id
      // here never turns a machine reading into a scheduled roster detection.
      staffId: driver?.staffId ?? null,
      staffNameSnapshot: driver?.staffName ?? null,
      vehicleId: vehicle.vehicleId,
      vehicleRegistrationSnapshot: vehicle.registration,
      projectId,
      metadata: sanitizeMetadata(event.metadata),
    });
    if (outcome.outcome !== 'opened') {
      result.incidentsUnchanged += 1;
      return;
    }
    result.incidentsOpened += 1;
    if (!outcome.requiresInitialNotification || !outcome.incidentId) return;

    // Same call, same recipient resolver and same shape monitorService uses on
    // 'opened'. It never throws — failures come back in NotifyResult.failed.
    const delivery = await deps.notifyOpened({
      incidentId: outcome.incidentId, incidentType: detector.incidentType,
      severity: rule.severity, producerKind: 'source_event', rule, projectId,
      staffName: driver?.staffName ?? null, projectName: null, operationalSiteName: null,
      vehicleRegistration: vehicle.registration,
      detectedAt: event.occurredAt, reasonCodes: [],
    });
    result.notificationsAccepted += delivery.delivered;
    result.notificationsFailed += delivery.failed;
  } catch (error) {
    result.producerFailures += 1;
    log.error(
      '[fleet-detectors] producing an incident failed',
      {
        detector: detector.id, vehicleId: vehicle.vehicleId,
        error: error instanceof Error ? error.message : String(error),
      },
      MODULE,
    );
  }
}

/**
 * One incident rule per detector, resolved once per tick.
 *
 * A missing rule is left out of the map rather than defaulted: the producer
 * refuses a source event with no effective rule anyway, and inventing a severity
 * here is how a type ends up notifying at the wrong urgency.
 */
export async function loadIncidentRules(
  deps: Pick<EmitterDeps, 'loadIncidentRule'> & { detectors: readonly RegisteredDetector[] },
  asOf: string,
): Promise<Map<IncidentType, IncidentRule>> {
  const rules = new Map<IncidentType, IncidentRule>();
  for (const detector of deps.detectors) {
    const rule = await deps.loadIncidentRule(detector.incidentType, asOf);
    if (rule) rules.set(detector.incidentType, rule);
  }
  return rules;
}

