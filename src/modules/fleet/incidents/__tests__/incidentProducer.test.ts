import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ transaction: vi.fn(), txnQuery: vi.fn(), txnQueryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ transaction: db.transaction }));

const repo = vi.hoisted(() => ({
  findActiveIncident: vi.fn(), findIncidentBySourceEvent: vi.fn(), createIncident: vi.fn(),
  touchIncidentLastSeen: vi.fn(), clearIncidentCondition: vi.fn(), recordObservation: vi.fn(), insertIncidentAction: vi.fn(),
}));
vi.mock('../incidentRepository', () => repo);

const settings = vi.hoisted(() => ({ loadEffectiveIncidentRule: vi.fn() }));
vi.mock('../settingsRepository', () => settings);

const logger = vi.hoisted(() => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/logger', () => logger);

import {
  IncidentProducerConfigurationError, IncidentProducerValidationError,
  evaluateConditionClearing, produceIncident, resolveScheduledIncidentType,
} from '../incidentProducer';
import { buildAssignmentIdentity, computeObservationFingerprint } from '../observationFingerprint';
import type {
  IncidentAssignmentContext, IncidentEvaluation, IncidentRule, IncidentRuleReference,
  IncidentSourceEvent, ScheduledIncidentProducerRequest,
} from '../types';

const STAFF = '11111111-1111-4111-8111-111111111111';
const INCIDENT = '22222222-2222-4222-8222-222222222222';
const ASSIGNMENT = '33333333-3333-4333-8333-333333333333';

function assignment(overrides: Partial<IncidentAssignmentContext> = {}): IncidentAssignmentContext {
  return {
    staffId: STAFF, vehicleId: null, projectId: 'project-1', operationalSiteId: 'site-1', operationalAssignmentId: ASSIGNMENT,
    staffNameSnapshot: 'Jane', projectNameSnapshot: 'Project', operationalSiteNameSnapshot: 'Site', vehicleRegistrationSnapshot: null,
    ...overrides,
  };
}
function rules(overrides: Partial<IncidentRuleReference> = {}): IncidentRuleReference {
  return { incidentRuleId: 'rule-1', incidentRuleVersion: 1, statusRuleId: 'status-rule-1', statusRuleVersion: 4, ...overrides };
}
function evaluation(overrides: Partial<IncidentEvaluation> = {}): IncidentEvaluation {
  return {
    observedAt: '2026-08-13T08:00:00.000Z', observationFingerprint: 'fp-1',
    primaryStatus: 'late', flags: [], reasonCodes: ['attendance_late'], ...overrides,
  };
}
function scheduledRequest(overrides: Partial<ScheduledIncidentProducerRequest> = {}): ScheduledIncidentProducerRequest {
  return {
    producerKind: 'scheduled_detection', incidentType: 'late', workDate: '2026-08-13',
    assignment: assignment(), rules: rules(), evaluation: evaluation(), severity: 'high', ...overrides,
  };
}
function incidentRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: INCIDENT, incidentReference: 'INC-LATE-20260813-ABC123', incidentType: 'late', severity: 'high',
    lifecycleStatus: 'open', staffId: STAFF, projectId: 'project-1', operationalSiteId: 'site-1',
    vehicleId: null, operationalAssignmentId: ASSIGNMENT, workDate: '2026-08-13',
    detectedAt: '2026-08-13T08:00:00.000Z', openedAt: '2026-08-13T08:00:00.000Z',
    conditionLastSeenAt: '2026-08-13T08:00:00.000Z', conditionClearedAt: null,
    acknowledgedBy: null, acknowledgedAt: null, reviewStartedBy: null, reviewStartedAt: null,
    escalationLevel: 0, lastEscalatedAt: null, nextEscalationAt: null,
    resolvedBy: null, resolvedAt: null, outcome: null, resolutionNote: null,
    linkedHsReference: null, linkedMaintenanceReference: null, ...overrides,
  };
}
function sourceEvent(overrides: Partial<IncidentSourceEvent> = {}): IncidentSourceEvent {
  return {
    producerKind: 'source_event', incidentType: 'accident_sos', sourceEventId: 'evt-1',
    occurredAt: '2026-08-13T08:00:00.000Z', staffId: STAFF, vehicleId: 'vehicle-1',
    projectId: 'project-1', operationalSiteId: 'site-1', operationalAssignmentId: ASSIGNMENT,
    linkedHsReference: null, linkedMaintenanceReference: null, metadata: { speedKmh: 140 }, ...overrides,
  };
}
function ruleRecord(overrides: Partial<IncidentRule> = {}): IncidentRule {
  return {
    id: 'rule-1', incidentType: 'accident_sos', version: 1, effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null,
    enabled: true, createsIncident: true, severity: 'critical', immediateNotification: true,
    channels: { inApp: true, email: true, whatsapp: true }, includeInMorningSummary: false,
    acknowledgementTargetMinutes: 5, reminderIntervalMinutes: 15, maximumEscalationLevel: 3,
    evidenceRequiredOutcomes: [], ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.transaction.mockImplementation(async (work: (txn: unknown) => Promise<unknown>) => work({
    query: db.txnQuery, queryOne: db.txnQueryOne, client: {},
  }));
  repo.insertIncidentAction.mockResolvedValue({ id: 'action-1' });
  repo.recordObservation.mockResolvedValue({ inserted: true, observationId: 'obs-1' });
});

describe('resolveScheduledIncidentType', () => {
  it('maps each PR6 incident-producing status to its incident type; every summary-only and normal status to null', () => {
    expect(resolveScheduledIncidentType('late')).toBe('late');
    expect(resolveScheduledIncidentType('wrong_site')).toBe('wrong_site');
    expect(resolveScheduledIncidentType('evidence_mismatch')).toBe('evidence_mismatch');
    expect(resolveScheduledIncidentType('left_early')).toBe('left_early');
    // summary-only
    expect(resolveScheduledIncidentType('unassigned')).toBeNull();
    expect(resolveScheduledIncidentType('unverifiable')).toBeNull();
    expect(resolveScheduledIncidentType('vehicle_on_site_driver_unconfirmed')).toBeNull();
    // normal
    expect(resolveScheduledIncidentType('off_duty')).toBeNull();
    expect(resolveScheduledIncidentType('scheduled_not_due')).toBeNull();
    expect(resolveScheduledIncidentType('approaching')).toBeNull();
    expect(resolveScheduledIncidentType('attendance_confirmed')).toBeNull();
    expect(resolveScheduledIncidentType('on_site_dual')).toBeNull();
    expect(resolveScheduledIncidentType('shift_complete')).toBeNull();
  });
});

describe('new scheduled detection', () => {
  it('opens exactly one incident/action/observation, with the request severity and rule reference', async () => {
    repo.findActiveIncident.mockResolvedValueOnce(null);
    repo.createIncident.mockResolvedValueOnce(incidentRecord());

    const result = await produceIncident(scheduledRequest({ severity: 'high' }));

    expect(result).toEqual({ outcome: 'opened', incidentId: INCIDENT, requiresInitialNotification: true });
    expect(repo.createIncident).toHaveBeenCalledTimes(1);
    expect(repo.createIncident.mock.calls[0]![0]).toMatchObject({
      incidentType: 'late', severity: 'high', staffId: STAFF,
      incidentRuleId: 'rule-1', incidentRuleVersion: 1, statusRuleId: 'status-rule-1', statusRuleVersion: 4,
    });
    expect(repo.insertIncidentAction).toHaveBeenCalledTimes(1);
    expect(repo.insertIncidentAction.mock.calls[0]![0]).toMatchObject({ incidentId: INCIDENT, actionType: 'opened', isSystemActor: true });
    expect(repo.recordObservation).toHaveBeenCalledTimes(1);
    expect(repo.recordObservation.mock.calls[0]![0]).toMatchObject({ incidentId: INCIDENT, observationFingerprint: 'fp-1' });
    expect(repo.touchIncidentLastSeen).not.toHaveBeenCalled();
  });

  it('records the observation against the STATUS rule, which is what observations.rule_id references', async () => {
    // Pinned because the source-event path had to stop writing a rule id here:
    // migration 510 points observations.rule_id at fleet_operational_status_rules,
    // so the scheduled path's status rule is the only id that may be written.
    repo.findActiveIncident.mockResolvedValueOnce(null);
    repo.createIncident.mockResolvedValueOnce(incidentRecord());

    await produceIncident(scheduledRequest());

    expect(repo.recordObservation.mock.calls[0]![0]).toMatchObject({
      ruleId: 'status-rule-1', ruleVersion: 4, monitorRunId: null, sourceEventId: null,
    });
  });

  it('permits recurrence after a prior terminal closure (no active row found for this staff/type/date)', async () => {
    repo.findActiveIncident.mockResolvedValueOnce(null); // terminal incidents fall outside the active-status filter
    repo.createIncident.mockResolvedValueOnce(incidentRecord({ id: 'new-incident' }));

    const result = await produceIncident(scheduledRequest());

    expect(result.outcome).toBe('opened');
    expect(result.incidentId).toBe('new-incident');
  });
});

describe('repeated scheduled detection', () => {
  it('updates last-seen without inserting a new action when the incident is already active', async () => {
    repo.findActiveIncident.mockResolvedValueOnce(incidentRecord());

    const result = await produceIncident(scheduledRequest());

    expect(result).toEqual({ outcome: 'updated', incidentId: INCIDENT, requiresInitialNotification: false });
    expect(repo.createIncident).not.toHaveBeenCalled();
    expect(repo.insertIncidentAction).not.toHaveBeenCalled();
    expect(repo.touchIncidentLastSeen).toHaveBeenCalledWith(INCIDENT, '2026-08-13T08:00:00.000Z', expect.anything());
    expect(repo.recordObservation).toHaveBeenCalledTimes(1);
    expect(repo.recordObservation.mock.calls[0]![0]).toMatchObject({ observationFingerprint: 'fp-1' });
  });

  it('appends exactly one observation carrying the new fingerprint when evidence materially changed', async () => {
    repo.findActiveIncident.mockResolvedValueOnce(incidentRecord());

    await produceIncident(scheduledRequest({
      evaluation: evaluation({ observationFingerprint: 'fp-2', reasonCodes: ['attendance_late', 'grace_expired'] }),
    }));

    expect(repo.recordObservation).toHaveBeenCalledTimes(1);
    expect(repo.recordObservation.mock.calls[0]![0]).toMatchObject({ observationFingerprint: 'fp-2' });
    expect(repo.insertIncidentAction).not.toHaveBeenCalled();
  });

  it('removes any stale condition_cleared_at on recurrence without opening a duplicate incident', async () => {
    repo.findActiveIncident.mockResolvedValueOnce(incidentRecord({ conditionClearedAt: '2026-08-13T07:00:00.000Z' }));

    const result = await produceIncident(scheduledRequest());

    expect(result.outcome).toBe('updated');
    expect(repo.createIncident).not.toHaveBeenCalled();
    expect(repo.touchIncidentLastSeen).toHaveBeenCalledTimes(1);
  });
});

describe('concurrent creates', () => {
  it('scheduled: converges on the winning row via the unique index and reload path instead of failing', async () => {
    repo.findActiveIncident
      .mockResolvedValueOnce(null) // initial check: nothing to lock yet
      .mockResolvedValueOnce(incidentRecord()); // reload after conflict: the other transaction's committed row
    repo.createIncident.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }));

    const result = await produceIncident(scheduledRequest());

    expect(result).toEqual({ outcome: 'updated', incidentId: INCIDENT, requiresInitialNotification: false });
    expect(db.txnQuery).toHaveBeenCalledWith('SAVEPOINT fleet_incident_create');
    expect(db.txnQuery).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT fleet_incident_create');
    expect(repo.touchIncidentLastSeen).toHaveBeenCalledTimes(1);
    expect(repo.insertIncidentAction).not.toHaveBeenCalled();
    expect(logger.log.warn).toHaveBeenCalledTimes(1);

    repo.findActiveIncident.mockResolvedValueOnce(null);
    repo.createIncident.mockRejectedValueOnce(new Error('connection reset')); // unrelated failure: not caught/retried
    await expect(produceIncident(scheduledRequest())).rejects.toThrow('connection reset');
  });

  it('source event: converges concurrent creates for the same event through the unique index and reload path', async () => {
    settings.loadEffectiveIncidentRule.mockResolvedValue(ruleRecord());
    repo.findIncidentBySourceEvent
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(incidentRecord({ incidentType: 'accident_sos', sourceEventId: 'evt-1' }));
    repo.createIncident.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }));

    const result = await produceIncident(sourceEvent());

    expect(result).toEqual({ outcome: 'unchanged', incidentId: INCIDENT, requiresInitialNotification: false });
    expect(repo.insertIncidentAction).not.toHaveBeenCalled();
  });
});

describe('scheduled request validation', () => {
  it('rejects a scheduled incident with no known staff identity or no severity', async () => {
    await expect(produceIncident(scheduledRequest({ assignment: assignment({ staffId: null }) })))
      .rejects.toThrow(IncidentProducerValidationError);
    await expect(produceIncident(scheduledRequest({ severity: undefined })))
      .rejects.toThrow(IncidentProducerValidationError);
  });
});

describe('condition clearing', () => {
  it('marks one condition_cleared action when evidence is healthy and the condition is absent; never clears on unhealthy evidence', async () => {
    repo.findActiveIncident.mockResolvedValueOnce(incidentRecord());
    const healthy = await evaluateConditionClearing({
      staffId: STAFF, incidentType: 'late', workDate: '2026-08-13', operationalAssignmentId: ASSIGNMENT,
      observedAt: '2026-08-13T09:00:00.000Z', evidenceHealthy: true,
    });
    expect(healthy).toEqual({ outcome: 'cleared', incidentId: INCIDENT, requiresInitialNotification: false });
    expect(repo.clearIncidentCondition).toHaveBeenCalledWith(INCIDENT, '2026-08-13T09:00:00.000Z', expect.anything());
    expect(repo.insertIncidentAction).toHaveBeenCalledTimes(1);
    expect(repo.insertIncidentAction.mock.calls[0]![0]).toMatchObject({ incidentId: INCIDENT, actionType: 'condition_cleared', isSystemActor: true });

    repo.findActiveIncident.mockResolvedValueOnce(incidentRecord());
    const unhealthy = await evaluateConditionClearing({
      staffId: STAFF, incidentType: 'late', workDate: '2026-08-13', operationalAssignmentId: ASSIGNMENT,
      observedAt: '2026-08-13T09:05:00.000Z', evidenceHealthy: false,
    });
    expect(unhealthy).toEqual({ outcome: 'unchanged', incidentId: INCIDENT, requiresInitialNotification: false });
    expect(repo.clearIncidentCondition).toHaveBeenCalledTimes(1); // still just the one call from the healthy case above
  });

  it('is a no-op with no active incident, and does not clear a second time once already cleared', async () => {
    repo.findActiveIncident.mockResolvedValueOnce(null);
    const clearingRequest = {
      staffId: STAFF, incidentType: 'late' as const, workDate: '2026-08-13', operationalAssignmentId: ASSIGNMENT,
      observedAt: '2026-08-13T09:00:00.000Z', evidenceHealthy: true,
    };
    expect(await evaluateConditionClearing(clearingRequest)).toEqual({ outcome: 'unchanged', incidentId: null, requiresInitialNotification: false });
    repo.findActiveIncident.mockResolvedValueOnce(incidentRecord({ conditionClearedAt: '2026-08-13T07:00:00.000Z' }));
    expect((await evaluateConditionClearing(clearingRequest)).outcome).toBe('unchanged');
    expect(repo.clearIncidentCondition).not.toHaveBeenCalled();
  });
});

describe('the scheduled path is not touched by vehicle attribution', () => {
  it('takes its staff identity and name from the ROSTER assignment, never from a vehicle lookup', async () => {
    // The mutation this exists for: wiring `resolveVehicleDriver` into the
    // scheduled branch. That path already carries a roster identity resolved
    // from Attendance/assignment evidence; re-resolving it from
    // `vehicle_assignments` would silently overwrite the person the roster
    // named with whoever holds the vehicle. This request names a vehicle AND a
    // roster driver, so the two answers are distinguishable.
    repo.findActiveIncident.mockResolvedValueOnce(null);
    repo.createIncident.mockResolvedValueOnce(incidentRecord());

    await produceIncident(scheduledRequest({
      assignment: assignment({ vehicleId: 'vehicle-1', vehicleRegistrationSnapshot: 'ABC 123 GP', staffNameSnapshot: 'Roster Driver' }),
    }));

    expect(repo.createIncident.mock.calls[0]![0]).toMatchObject({
      staffId: STAFF, staffNameSnapshot: 'Roster Driver', vehicleId: 'vehicle-1',
    });
  });
});

describe('source events', () => {
  beforeEach(() => { settings.loadEffectiveIncidentRule.mockResolvedValue(ruleRecord()); });

  it('requires a stable, non-blank source event id and accepts only the supported source-event incident types', async () => {
    await expect(produceIncident(sourceEvent({ sourceEventId: '  ' }))).rejects.toThrow(IncidentProducerValidationError);
    await expect(produceIncident(sourceEvent({ incidentType: 'late' }))).rejects.toThrow(IncidentProducerValidationError);
    await expect(produceIncident(sourceEvent({ incidentType: 'unassigned' }))).rejects.toThrow(IncidentProducerValidationError);
    expect(repo.findIncidentBySourceEvent).not.toHaveBeenCalled();
  });

  it('deduplicates a redelivered event by type and id without creating a duplicate', async () => {
    repo.findIncidentBySourceEvent.mockResolvedValueOnce(incidentRecord({ incidentType: 'accident_sos', sourceEventId: 'evt-1' }));

    const result = await produceIncident(sourceEvent());

    expect(result).toEqual({ outcome: 'unchanged', incidentId: INCIDENT, requiresInitialNotification: false });
    expect(repo.createIncident).not.toHaveBeenCalled();
  });

  it('opens one incident and preserves a linked H&S/maintenance reference', async () => {
    repo.findIncidentBySourceEvent.mockResolvedValueOnce(null);
    repo.createIncident.mockResolvedValueOnce(incidentRecord({ incidentType: 'accident_sos', linkedHsReference: 'HS-2026-004' }));

    const result = await produceIncident(sourceEvent({ linkedHsReference: 'HS-2026-004' }));

    expect(result).toEqual({ outcome: 'opened', incidentId: INCIDENT, requiresInitialNotification: true });
    expect(repo.createIncident.mock.calls[0]![0]).toMatchObject({
      sourceEventId: 'evt-1', linkedHsReference: 'HS-2026-004', incidentRuleId: 'rule-1', incidentRuleVersion: 1,
    });
    expect(repo.insertIncidentAction).toHaveBeenCalledTimes(1);
    expect(repo.recordObservation).toHaveBeenCalledTimes(1);
  });

  it('writes the vehicle registration snapshot the caller supplied', async () => {
    // The one human label a vehicle incident carries: the source-event path
    // hardcoded null here, so a telematics WhatsApp named neither a person (it
    // has none) nor a vehicle. Pinned at the producer layer because the
    // detector's own test can only prove what it PASSED, not what was stored.
    repo.findIncidentBySourceEvent.mockResolvedValueOnce(null);
    repo.createIncident.mockResolvedValueOnce(incidentRecord({ incidentType: 'accident_sos' }));

    await produceIncident(sourceEvent({ vehicleRegistrationSnapshot: 'ABC 123 GP' }));

    expect(repo.createIncident.mock.calls[0]![0]).toMatchObject({
      vehicleId: 'vehicle-1', vehicleRegistrationSnapshot: 'ABC 123 GP',
    });
  });

  it('writes the driver attribution the detector resolved — id AND name snapshot', async () => {
    // The queue, the escalation mail and the WhatsApp body all read
    // `staff_name_snapshot`; an incident carrying only `staff_id` still renders
    // "Unassigned". Pinned here because the detector's own test can prove only
    // what it PASSED, not what was stored.
    repo.findIncidentBySourceEvent.mockResolvedValueOnce(null);
    repo.createIncident.mockResolvedValueOnce(incidentRecord({ incidentType: 'accident_sos' }));

    await produceIncident(sourceEvent({ staffId: STAFF, staffNameSnapshot: 'Jane Driver' }));

    expect(repo.createIncident.mock.calls[0]![0]).toMatchObject({ staffId: STAFF, staffNameSnapshot: 'Jane Driver' });
  });

  it('stores a null staff snapshot when the event resolved no driver', async () => {
    repo.findIncidentBySourceEvent.mockResolvedValueOnce(null);
    repo.createIncident.mockResolvedValueOnce(incidentRecord({ incidentType: 'accident_sos' }));

    await produceIncident(sourceEvent({ staffId: null }));

    expect(repo.createIncident.mock.calls[0]![0]).toMatchObject({ staffId: null, staffNameSnapshot: null });
  });

  it('refuses a name with no staff id — a snapshot nobody can be asked about', async () => {
    // `staff_name_snapshot` is what the queue and every alert render, so a name
    // stored beside a null `staff_id` would show a manager a driver they cannot
    // request input from and whose `/my` surface the incident never reaches.
    // The producer drops the name rather than displaying an unactionable one.
    repo.findIncidentBySourceEvent.mockResolvedValueOnce(null);
    repo.createIncident.mockResolvedValueOnce(incidentRecord({ incidentType: 'accident_sos' }));

    await produceIncident(sourceEvent({ staffId: null, staffNameSnapshot: 'Jane Driver' }));

    expect(repo.createIncident.mock.calls[0]![0]).toMatchObject({ staffId: null, staffNameSnapshot: null });
  });

  it('stores null when the caller supplies no registration, never undefined', async () => {
    repo.findIncidentBySourceEvent.mockResolvedValueOnce(null);
    repo.createIncident.mockResolvedValueOnce(incidentRecord({ incidentType: 'accident_sos' }));

    await produceIncident(sourceEvent());

    expect(repo.createIncident.mock.calls[0]![0]).toHaveProperty('vehicleRegistrationSnapshot', null);
  });

  it('throws a configuration error when no effective rule exists for the source-event type', async () => {
    settings.loadEffectiveIncidentRule.mockResolvedValueOnce(null);

    await expect(produceIncident(sourceEvent())).rejects.toThrow(IncidentProducerConfigurationError);
  });

  it('records the observation with no rule reference, because the incident rule is not a status rule', async () => {
    // The production defect: observations.rule_id is an FK to
    // fleet_operational_status_rules (migration 510), and this path wrote the
    // INCIDENT rule's id — an id that never exists in that table — so every real
    // source event died on
    // fleet_operational_incident_observations_rule_id_fkey and no incident opened.
    // The incident row still carries incidentRuleId/Version, so null here loses nothing.
    repo.findIncidentBySourceEvent.mockResolvedValueOnce(null);
    repo.createIncident.mockResolvedValueOnce(incidentRecord({ incidentType: 'accident_sos' }));

    await produceIncident(sourceEvent());

    const observation = repo.recordObservation.mock.calls[0]![0];
    expect(observation).toHaveProperty('ruleId', null);
    expect(observation).toHaveProperty('ruleVersion', null);
    expect(observation).toMatchObject({ sourceEventId: 'evt-1', monitorRunId: null });
    // The incident itself keeps the rule identity, which is why nulling the
    // observation columns is lossless rather than a downgrade.
    expect(repo.createIncident.mock.calls[0]![0]).toMatchObject({
      incidentRuleId: 'rule-1', incidentRuleVersion: 1, statusRuleId: null, statusRuleVersion: null,
    });
  });

  it('keeps the observation fingerprint keyed on the incident rule, so dedup is unchanged by the null columns', async () => {
    repo.findIncidentBySourceEvent.mockResolvedValueOnce(null);
    repo.createIncident.mockResolvedValueOnce(incidentRecord({ incidentType: 'accident_sos' }));

    await produceIncident(sourceEvent());

    const expected = computeObservationFingerprint({
      incidentType: 'accident_sos', ruleId: 'rule-1', ruleVersion: 1,
      assignmentIdentity: buildAssignmentIdentity(STAFF, 'vehicle-1', ASSIGNMENT),
      reasonCodes: [], freshnessBucket: null, siteId: 'site-1', projectId: 'project-1',
      vehicleId: 'vehicle-1', conditionActive: true,
    });
    expect(repo.recordObservation.mock.calls[0]![0]).toMatchObject({ observationFingerprint: expected });

    // Same context, different event id: the fingerprint is stable, and a redelivery
    // of the SAME event short-circuits to 'unchanged' before any observation insert.
    repo.findIncidentBySourceEvent.mockResolvedValueOnce(null);
    repo.createIncident.mockResolvedValueOnce(incidentRecord({ incidentType: 'accident_sos' }));
    await produceIncident(sourceEvent({ sourceEventId: 'evt-2' }));
    expect(repo.recordObservation.mock.calls[1]![0]).toMatchObject({ observationFingerprint: expected });

    repo.findIncidentBySourceEvent.mockResolvedValueOnce(incidentRecord({ incidentType: 'accident_sos', sourceEventId: 'evt-1' }));
    const redelivered = await produceIncident(sourceEvent());
    expect(redelivered).toEqual({ outcome: 'unchanged', incidentId: INCIDENT, requiresInitialNotification: false });
    expect(repo.recordObservation).toHaveBeenCalledTimes(2);
  });
});
