import { describe, expect, it, vi } from 'vitest';
import type { TxnClient } from '@/lib/db-pool';
import {
  IncidentNotFoundError,
  acknowledgeIncident,
  clearIncidentCondition,
  createIncident,
  findActiveIncident,
  findIncidentBySourceEvent,
  insertIncidentAction,
  insertIncidentEvidence,
  recordObservation,
  touchIncidentLastSeen,
  type CreateIncidentInput,
} from '../incidentRepository';

const STAFF = '11111111-1111-4111-8111-111111111111';
const INCIDENT = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

function fakeTxn(): TxnClient & { query: ReturnType<typeof vi.fn>; queryOne: ReturnType<typeof vi.fn> } {
  const query = vi.fn();
  const queryOne = vi.fn();
  return { query, queryOne, client: {} as never } as unknown as TxnClient & { query: typeof query; queryOne: typeof queryOne };
}

const incidentRow = {
  id: INCIDENT, incident_reference: 'INC-LATE-20260813-ABC123', incident_type: 'late', severity: 'high',
  lifecycle_status: 'open', staff_id: STAFF, project_id: null, operational_site_id: null,
  vehicle_id: null, operational_assignment_id: null, work_date: '2026-08-13',
  staff_name_snapshot: 'Jane', project_name_snapshot: null, operational_site_name_snapshot: null,
  vehicle_registration_snapshot: null, source_event_id: null, status_rule_id: null, status_rule_version: null,
  incident_rule_id: null, incident_rule_version: null, evidence_snapshot: {}, detected_at: '2026-08-13T08:00:00.000Z',
  opened_at: '2026-08-13T08:00:00.000Z', condition_last_seen_at: '2026-08-13T08:00:00.000Z', condition_cleared_at: null,
  acknowledged_by: null, acknowledged_at: null, review_started_by: null, review_started_at: null,
  escalation_level: 0, last_escalated_at: null, next_escalation_at: null,
  resolved_by: null, resolved_at: null, outcome: null, resolution_note: null,
  duplicate_incident_id: null, linked_hs_reference: null, linked_maintenance_reference: null,
};

function baseCreateInput(): CreateIncidentInput {
  return {
    incidentType: 'late', severity: 'high', staffId: STAFF, projectId: null,
    operationalSiteId: null, vehicleId: null, operationalAssignmentId: null, workDate: '2026-08-13',
    staffNameSnapshot: 'Jane', projectNameSnapshot: null, operationalSiteNameSnapshot: null,
    vehicleRegistrationSnapshot: null, sourceEventId: null, statusRuleId: null, statusRuleVersion: null,
    incidentRuleId: null, incidentRuleVersion: null, evidenceSnapshot: {}, detectedAt: '2026-08-13T08:00:00.000Z',
    linkedHsReference: null, linkedMaintenanceReference: null,
  };
}

describe('active incident lookup', () => {
  it('locks and normalizes a null assignment to the sentinel', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValue(incidentRow);

    const result = await findActiveIncident(
      { staffId: STAFF, incidentType: 'late', workDate: '2026-08-13', operationalAssignmentId: null }, txn,
    );

    expect(result).toMatchObject({ id: INCIDENT, lifecycleStatus: 'open' });
    const [text, params] = txn.queryOne.mock.calls[0]!;
    expect(text).toContain('FOR UPDATE');
    expect(text).toContain('lifecycle_status = ANY($6::text[])');
    expect(params).toEqual([
      STAFF, 'late', '2026-08-13', null, '00000000-0000-0000-0000-000000000000',
      ['open', 'acknowledged', 'under_review'],
    ]);
  });

  it('returns null when no active incident matches', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValue(null);

    await expect(findActiveIncident(
      { staffId: STAFF, incidentType: 'late', workDate: '2026-08-13', operationalAssignmentId: null }, txn,
    )).resolves.toBeNull();
  });
});

describe('recurrence after terminal closure', () => {
  it('does not find a terminal incident as active, so a new one can be created', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValueOnce(null); // terminal incidents fall outside the active-status filter

    const active = await findActiveIncident(
      { staffId: STAFF, incidentType: 'late', workDate: '2026-08-13', operationalAssignmentId: null }, txn,
    );
    expect(active).toBeNull();

    txn.queryOne.mockResolvedValueOnce({ ...incidentRow, id: 'new-incident' });
    const created = await createIncident(baseCreateInput(), txn);
    expect(created.id).toBe('new-incident');
  });
});

describe('createIncident', () => {
  it('generates a bounded, human-readable reference and inserts a new row', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValue(incidentRow);

    const created = await createIncident(baseCreateInput(), txn);

    expect(created.incidentReference).toBe(incidentRow.incident_reference);
    const [text, params] = txn.queryOne.mock.calls[0]!;
    expect(text).toContain('INSERT INTO fleet_operational_incidents');
    expect(params[0]).toMatch(/^INC-LATE-\d{8}-[0-9A-F]{6}$/);
  });
});

describe('source-event uniqueness', () => {
  it('locks the row for the incident type and source event id', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValue({ ...incidentRow, source_event_id: 'ext-1' });

    const found = await findIncidentBySourceEvent('accident_sos', 'ext-1', txn);

    expect(found).toMatchObject({ id: INCIDENT });
    const [text, params] = txn.queryOne.mock.calls[0]!;
    expect(text).toContain('source_event_id = $2');
    expect(text).toContain('FOR UPDATE');
    expect(params).toEqual(['accident_sos', 'ext-1']);
  });

  it('returns null when no incident has claimed the source event id yet', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValue(null);

    await expect(findIncidentBySourceEvent('accident_sos', 'ext-2', txn)).resolves.toBeNull();
  });
});

function observationInput() {
  return {
    incidentId: INCIDENT, observationFingerprint: 'fp-1', observedAt: '2026-08-13T08:05:00.000Z',
    primaryStatus: 'late', flags: [], ruleId: null, ruleVersion: null, evidenceSnapshot: {},
    reasonCodes: [], monitorRunId: null, sourceEventId: null,
  };
}

describe('unchanged-observation deduplication', () => {
  it('inserts a new observation when the fingerprint changed', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValue({ id: 'obs-1' });

    const result = await recordObservation(observationInput(), txn);

    expect(result).toEqual({ inserted: true, observationId: 'obs-1' });
    expect(txn.queryOne.mock.calls[0]?.[0]).toContain('ON CONFLICT (incident_id, observation_fingerprint) DO NOTHING');
  });

  it('reports no insert when the fingerprint repeats unchanged', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValue(null);

    const result = await recordObservation(observationInput(), txn);

    expect(result).toEqual({ inserted: false, observationId: null });
  });
});

describe('append-only action and evidence writes', () => {
  it('inserts an action with no update or delete statements', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValue({
      id: 'act-1', action_type: 'commented', actor_user_id: USER, is_system_actor: false,
      occurred_at: '2026-08-13T08:10:00.000Z', note: 'Checked in with the driver', before_lifecycle_status: 'acknowledged',
      after_lifecycle_status: 'acknowledged', before_escalation_level: 0, after_escalation_level: 0,
      metadata: {}, request_correlation_id: null,
    });

    const action = await insertIncidentAction({
      incidentId: INCIDENT, actionType: 'commented', actorUserId: USER, isSystemActor: false,
      note: 'Checked in with the driver', beforeLifecycleStatus: 'acknowledged', afterLifecycleStatus: 'acknowledged',
      beforeEscalationLevel: 0, afterEscalationLevel: 0, metadata: {}, requestCorrelationId: null,
    }, txn);

    expect(action.id).toBe('act-1');
    const [text] = txn.queryOne.mock.calls[0]!;
    expect(text).toContain('INSERT INTO fleet_operational_incident_actions');
    expect(text).not.toMatch(/UPDATE|DELETE/);
  });

  it('inserts evidence with no update or delete statements', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValue({
      id: 'ev-1', evidence_type: 'photo', storage_url: 'https://app.fibreflow.app/storage/x',
      storage_key: 'fleet/incidents/x', mime_type: 'image/jpeg', original_filename: 'photo.jpg',
      uploaded_by: USER, description: null, created_at: '2026-08-13T08:12:00.000Z',
    });

    const evidence = await insertIncidentEvidence({
      incidentId: INCIDENT, evidenceType: 'photo', storageUrl: 'https://app.fibreflow.app/storage/x',
      storageKey: 'fleet/incidents/x', mimeType: 'image/jpeg', originalFilename: 'photo.jpg',
      uploadedBy: USER, description: null,
    }, txn);

    expect(evidence.id).toBe('ev-1');
    const [text] = txn.queryOne.mock.calls[0]!;
    expect(text).toContain('INSERT INTO fleet_operational_incident_evidence');
    expect(text).not.toMatch(/UPDATE|DELETE/);
  });
});

describe('acknowledgement', () => {
  it('acknowledges an open incident, locking it first, and appends exactly one action', async () => {
    const txn = fakeTxn();
    txn.queryOne
      .mockResolvedValueOnce({ lifecycle_status: 'open', escalation_level: 0 })
      .mockResolvedValueOnce({ lifecycle_status: 'acknowledged' })
      .mockResolvedValueOnce({
        id: 'act-1', action_type: 'acknowledged', actor_user_id: USER, is_system_actor: false,
        occurred_at: '2026-08-13T08:10:00.000Z', note: null, before_lifecycle_status: 'open',
        after_lifecycle_status: 'acknowledged', before_escalation_level: 0, after_escalation_level: 0,
        metadata: {}, request_correlation_id: null,
      });

    const result = await acknowledgeIncident(INCIDENT, USER, null, null, txn);

    expect(result).toEqual({ outcome: 'acknowledged', lifecycleStatus: 'acknowledged', actionId: 'act-1' });
    expect(txn.queryOne.mock.calls[0]?.[0]).toContain('FOR UPDATE');
    expect(txn.queryOne).toHaveBeenCalledTimes(3);
  });

  it('returns the current state without a second action for an already-acknowledged incident', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValueOnce({ lifecycle_status: 'under_review', escalation_level: 1 });

    const result = await acknowledgeIncident(INCIDENT, USER, null, null, txn);

    expect(result).toEqual({ outcome: 'already_acknowledged', lifecycleStatus: 'under_review', actionId: null });
    expect(txn.queryOne).toHaveBeenCalledTimes(1);
  });

  it('reports a terminal conflict for a resolved incident and makes no mutation', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValueOnce({ lifecycle_status: 'resolved', escalation_level: 0 });

    const result = await acknowledgeIncident(INCIDENT, USER, null, null, txn);

    expect(result).toEqual({ outcome: 'terminal_conflict', lifecycleStatus: 'resolved', actionId: null });
    expect(txn.queryOne).toHaveBeenCalledTimes(1);
    expect(txn.query).not.toHaveBeenCalled();
  });

  it('reports a terminal conflict for a dismissed incident', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValueOnce({ lifecycle_status: 'dismissed', escalation_level: 0 });

    const result = await acknowledgeIncident(INCIDENT, USER, null, null, txn);

    expect(result.outcome).toBe('terminal_conflict');
  });

  it('throws when the incident does not exist', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValueOnce(null);

    await expect(acknowledgeIncident(INCIDENT, USER, null, null, txn)).rejects.toBeInstanceOf(IncidentNotFoundError);
  });
});

describe('condition tracking', () => {
  it('touches last-seen and clears any prior condition-cleared marker on recurrence', async () => {
    const txn = fakeTxn();
    txn.query.mockResolvedValue([]);

    await touchIncidentLastSeen(INCIDENT, '2026-08-13T09:00:00.000Z', txn);

    const [text, params] = txn.query.mock.calls[0]!;
    expect(text).toContain('condition_cleared_at = NULL');
    expect(params).toEqual([INCIDENT, '2026-08-13T09:00:00.000Z']);
  });

  it('clears the condition only while it is not already cleared', async () => {
    const txn = fakeTxn();
    txn.query.mockResolvedValue([]);

    await clearIncidentCondition(INCIDENT, '2026-08-13T10:00:00.000Z', txn);

    expect(txn.query.mock.calls[0]?.[0]).toContain('condition_cleared_at IS NULL');
  });
});
