/**
 * The detector phase's orchestration contract.
 *
 * Three properties are load-bearing and each has its own test:
 *
 *   1. what reaches the producer — `producerKind:'source_event'`, a non-null
 *      `vehicleId`, metadata of flat primitives only, and the driver
 *      `vehicle_assignments` names for that vehicle at the event instant
 *      (`staffId` + `staffNameSnapshot`, both null when no assignment covers
 *      it). `producerKind` alone selects the producer's branch, so attribution
 *      never turns a telematics reading into a scheduled roster detection.
 *   2. a second tick over the same data opens nothing — the producer answers
 *      `unchanged`, which only works if the ids are deterministic.
 *   3. isolation — one throwing detector, one failing vehicle load and one
 *      refused producer call each leave the rest of the tick intact and mark
 *      the phase `partial`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { runVehicleDetectors, type VehicleDetectorDeps } from '../vehicleDetectorService';
import { sanitizeMetadata } from '../detectedEventEmitter';
import { INCIDENT_RULE, RULE, VEHICLE, VEHICLE_ID, latOffset, position } from './detectorFixtures';

const DELIVERED = { delivered: 2, suppressed: 0, failed: 0 };

const NOW = '2026-08-18T19:00:00.000Z';
const OTHER_VEHICLE = { vehicleId: 'b2b2b2b2-2222-4222-8222-222222222222', registration: 'XYZ', afterHoursExempt: false };

/** Three after-hours fixes (21:10 SAST) 600 m apart: exactly one theft event. */
function theftNight() {
  return [0, 1, 2].map((i) => position({
    recordedAt: new Date(Date.parse('2026-08-18T19:10:00.000Z') + i * 60_000).toISOString(),
    providerEventId: `ct-${i}`,
    lat: latOffset(-26.1, i === 0 ? 0 : 600),
    speedKph: 60,
  }));
}

function deps(overrides: Partial<VehicleDetectorDeps> = {}): Partial<VehicleDetectorDeps> {
  return {
    loadVehicles: vi.fn(async () => [VEHICLE]),
    loadWindow: vi.fn(async () => theftNight()),
    loadLast: vi.fn(async () => null),
    loadGapP90: vi.fn(async () => 30),
    loadRule: vi.fn(async () => RULE),
    loadHolidayDates: vi.fn(async () => new Set<string>()),
    resolveProjectId: vi.fn(async () => null),
    resolveDriver: vi.fn(async () => null),
    loadIncidentRule: vi.fn(async () => INCIDENT_RULE),
    produce: vi.fn(async () => ({ outcome: 'opened' as const, incidentId: 'inc-1', requiresInitialNotification: true })),
    notifyOpened: vi.fn(async () => ({ ...DELIVERED })),
    ...overrides,
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('runVehicleDetectors — the producer contract', () => {
  it('produces a source event for a VEHICLE, unattributed when no assignment covers the instant', async () => {
    const produce = vi.fn(async () => ({ outcome: 'opened' as const, incidentId: 'inc-1', requiresInitialNotification: true }));

    const result = await runVehicleDetectors({ now: NOW }, deps({ produce }));

    expect(produce).toHaveBeenCalledTimes(1);
    expect(produce.mock.calls[0]?.[0]).toMatchObject({
      producerKind: 'source_event',
      incidentType: 'theft_after_hours_movement',
      staffId: null,
      staffNameSnapshot: null,
      vehicleId: VEHICLE_ID,
      vehicleRegistrationSnapshot: 'ABC 123 GP',
      projectId: null,
    });
    expect(result).toMatchObject({ status: 'succeeded', incidentsOpened: 1, eventsDetected: 1 });
  });

  it('attributes the incident to the vehicle\'s driver at the EVENT instant', async () => {
    // The queue said "Unassigned" for every telematics incident before this,
    // and a manager cannot request input from a driver the incident does not
    // name. The resolver is asked about this vehicle at the moment the event
    // occurred — not "now" — so a stale assignment cannot be back-attributed.
    const produce = vi.fn(async () => ({ outcome: 'opened' as const, incidentId: 'inc-1', requiresInitialNotification: true }));
    const resolveDriver = vi.fn(async () => ({ staffId: 'staff-7', staffName: 'Jane Driver' }));

    await runVehicleDetectors({ now: NOW }, deps({ produce, resolveDriver }));

    const produced = produce.mock.calls[0]?.[0] as unknown as { occurredAt: string };
    expect(resolveDriver).toHaveBeenCalledWith(VEHICLE_ID, produced.occurredAt);
    expect(produce.mock.calls[0]?.[0]).toMatchObject({
      producerKind: 'source_event', staffId: 'staff-7', staffNameSnapshot: 'Jane Driver',
      vehicleId: VEHICLE_ID, vehicleRegistrationSnapshot: 'ABC 123 GP',
    });
  });

  it('passes the resolved project through', async () => {
    const produce = vi.fn(async () => ({ outcome: 'opened' as const, incidentId: 'inc-1', requiresInitialNotification: true }));
    const resolveProjectId = vi.fn(async () => 'project-9');

    await runVehicleDetectors({ now: NOW }, deps({ produce, resolveProjectId }));

    expect(produce.mock.calls[0]?.[0]).toMatchObject({ projectId: 'project-9' });
  });

  it('sends metadata of flat primitives only', async () => {
    const produce = vi.fn(async () => ({ outcome: 'opened' as const, incidentId: 'inc-1', requiresInitialNotification: true }));

    await runVehicleDetectors({ now: NOW }, deps({ produce }));

    const call = produce.mock.calls[0]?.[0] as { metadata: Record<string, unknown> };
    for (const value of Object.values(call.metadata)) {
      expect(value === null || ['string', 'number', 'boolean'].includes(typeof value)).toBe(true);
    }
  });

  it('opens nothing on a second tick over the same data', async () => {
    const produce = vi.fn(async () => ({ outcome: 'unchanged' as const, incidentId: 'inc-1', requiresInitialNotification: false }));

    const first = await runVehicleDetectors({ now: NOW }, deps());
    const second = await runVehicleDetectors({ now: NOW }, deps({ produce }));

    expect(first.incidentsOpened).toBe(1);
    expect(second.incidentsOpened).toBe(0);
    expect(second.incidentsUnchanged).toBe(1);
    expect(second.status).toBe('succeeded');
  });

  it('sends the same source-event id on both ticks', async () => {
    const ids: string[] = [];
    const produce = vi.fn(async (request: { sourceEventId: string }) => {
      ids.push(request.sourceEventId);
      return { outcome: 'opened' as const, incidentId: 'inc-1', requiresInitialNotification: true };
    });

    await runVehicleDetectors({ now: NOW }, deps({ produce }));
    await runVehicleDetectors({ now: '2026-08-18T19:05:00.000Z' }, deps({ produce }));

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(1);
  });
});

describe('runVehicleDetectors — the opened notification', () => {
  it('notifies on a newly opened incident, naming the vehicle', async () => {
    const notifyOpened = vi.fn(async () => ({ ...DELIVERED }));

    const result = await runVehicleDetectors({ now: NOW }, deps({ notifyOpened }));

    expect(notifyOpened).toHaveBeenCalledTimes(1);
    expect(notifyOpened.mock.calls[0]?.[0]).toMatchObject({
      incidentId: 'inc-1',
      incidentType: 'theft_after_hours_movement',
      producerKind: 'source_event',
      severity: 'critical',
      staffName: null,
      vehicleRegistration: 'ABC 123 GP',
    });
    expect(result).toMatchObject({ notificationsAccepted: 2, notificationsFailed: 0 });
  });

  it('names the attributed driver in the opened notification', async () => {
    // `openedBody` is `staffName ?? vehicleRegistration ?? 'Unknown staff'`,
    // so the alert only names the person if this call carries the name.
    const notifyOpened = vi.fn(async () => ({ ...DELIVERED }));
    const resolveDriver = vi.fn(async () => ({ staffId: 'staff-7', staffName: 'Jane Driver' }));

    await runVehicleDetectors({ now: NOW }, deps({ notifyOpened, resolveDriver }));

    expect(notifyOpened.mock.calls[0]?.[0]).toMatchObject({
      staffName: 'Jane Driver', vehicleRegistration: 'ABC 123 GP',
    });
  });

  it('does NOT notify again on a second tick over the same data', async () => {
    const notifyOpened = vi.fn(async () => ({ ...DELIVERED }));
    const produce = vi.fn(async () => ({
      outcome: 'unchanged' as const, incidentId: 'inc-1', requiresInitialNotification: false,
    }));

    await runVehicleDetectors({ now: NOW }, deps({ produce, notifyOpened }));

    expect(notifyOpened).not.toHaveBeenCalled();
  });

  it('does not notify when the producer says no initial notification is required', async () => {
    const notifyOpened = vi.fn(async () => ({ ...DELIVERED }));
    const produce = vi.fn(async () => ({
      outcome: 'opened' as const, incidentId: 'inc-1', requiresInitialNotification: false,
    }));

    const result = await runVehicleDetectors({ now: NOW }, deps({ produce, notifyOpened }));

    expect(notifyOpened).not.toHaveBeenCalled();
    expect(result.incidentsOpened).toBe(1);
  });

  it('counts a failed delivery without failing the incident', async () => {
    const notifyOpened = vi.fn(async () => ({ delivered: 0, suppressed: 0, failed: 1 }));

    const result = await runVehicleDetectors({ now: NOW }, deps({ notifyOpened }));

    expect(result).toMatchObject({ incidentsOpened: 1, notificationsFailed: 1, status: 'succeeded' });
  });

  it('opens nothing for a type whose incident rule is disabled', async () => {
    const produce = vi.fn();
    const loadIncidentRule = vi.fn(async () => ({ ...INCIDENT_RULE, enabled: false }));

    const result = await runVehicleDetectors({ now: NOW }, deps({ loadIncidentRule, produce }));

    expect(produce).not.toHaveBeenCalled();
    expect(result).toMatchObject({ incidentsSuppressedByRule: 1, incidentsOpened: 0, status: 'succeeded' });
  });

  it('opens nothing for a rule configured not to create incidents', async () => {
    const produce = vi.fn();
    const loadIncidentRule = vi.fn(async () => ({ ...INCIDENT_RULE, createsIncident: false }));

    await runVehicleDetectors({ now: NOW }, deps({ loadIncidentRule, produce }));

    expect(produce).not.toHaveBeenCalled();
  });

  it('opens nothing when no incident rule is effective for the type', async () => {
    const produce = vi.fn();

    const result = await runVehicleDetectors({ now: NOW }, deps({
      loadIncidentRule: vi.fn(async () => null), produce,
    }));

    expect(produce).not.toHaveBeenCalled();
    expect(result.incidentsSuppressedByRule).toBe(1);
  });
});

describe('runVehicleDetectors — isolation', () => {
  it('isolates a throwing detector and reports the phase partial', async () => {
    const good = vi.fn(async () => []);
    const detectors = [
      { id: 'boom', incidentType: 'severe_driving' as const, run: async () => { throw new Error('detector fault'); } },
      { id: 'fine', incidentType: 'lost_contact_moving' as const, run: good },
    ];

    const result = await runVehicleDetectors({ now: NOW }, deps({ detectors }));

    expect(good).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'partial', detectorFailures: 1, vehiclesEvaluated: 1 });
  });

  it('isolates a failing vehicle load and keeps going through the fleet', async () => {
    const loadWindow = vi.fn(async (vehicleId: string) => {
      if (vehicleId === VEHICLE_ID) throw new Error('position read failed');
      return theftNight();
    });

    const result = await runVehicleDetectors({ now: NOW }, deps({
      loadVehicles: vi.fn(async () => [VEHICLE, OTHER_VEHICLE]), loadWindow,
    }));

    expect(result).toMatchObject({ status: 'partial', vehiclesEvaluated: 1, incidentsOpened: 1 });
  });

  it('isolates a refused producer call', async () => {
    const produce = vi.fn(async () => { throw new Error('incident insert rejected'); });

    const result = await runVehicleDetectors({ now: NOW }, deps({ produce }));

    expect(result).toMatchObject({ status: 'partial', producerFailures: 1, incidentsOpened: 0 });
  });

  it('fails the phase, without throwing, when no vehicle rule is effective', async () => {
    const produce = vi.fn();

    const result = await runVehicleDetectors({ now: NOW }, deps({ loadRule: vi.fn(async () => null), produce }));

    expect(result.status).toBe('failed');
    expect(produce).not.toHaveBeenCalled();
  });

  it('skips cleanly when no vehicle has an active tracker', async () => {
    const result = await runVehicleDetectors({ now: NOW }, deps({ loadVehicles: vi.fn(async () => []) }));

    expect(result).toMatchObject({ status: 'skipped', vehiclesEvaluated: 0 });
  });
});

describe('sanitizeMetadata', () => {
  it('keeps primitives and nulls, drops anything nested', () => {
    const clean = sanitizeMetadata({
      registration: 'ABC 123 GP', meters: 600, exempt: false, place: null,
      // A nested object would type-check at some call sites and land in
      // evidence_snapshot as something no reader can render.
      nested: { a: 1 } as unknown as string,
    });

    expect(clean).toEqual({ registration: 'ABC 123 GP', meters: 600, exempt: false, place: null });
  });
});
