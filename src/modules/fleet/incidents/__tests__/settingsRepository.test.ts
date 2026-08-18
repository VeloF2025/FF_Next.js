import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
  txnQuery: vi.fn(),
  txnQueryOne: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => ({
  query: db.query,
  queryOne: db.queryOne,
  transaction: db.transaction,
}));

import {
  IncidentSettingsValidationError,
  OversightMembershipConflictError,
  OversightMembershipNotFoundError,
  addOversightMember,
  endOversightMembership,
  listIncidentRuleVersions,
  listOversightMembers,
  loadEffectiveIncidentRule,
  versionIncidentRule,
} from '../settingsRepository';
import type { IncidentRuleChangeRequest } from '../types';

const RULE_ID = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';

const ruleRow = {
  id: RULE_ID, incident_type: 'late', version: 1,
  effective_from: '2026-08-01T00:00:00.000Z', effective_to: null,
  enabled: true, creates_incident: true, severity: 'high', immediate_notification: true,
  in_app_enabled: true, email_enabled: true, whatsapp_enabled: false,
  include_in_morning_summary: false, acknowledgement_target_minutes: 15,
  reminder_interval_minutes: 15, maximum_escalation_level: 3, evidence_required_outcomes: [],
};

const changeRequest: IncidentRuleChangeRequest = {
  incidentType: 'late', enabled: true, createsIncident: true, severity: 'high',
  immediateNotification: true, channels: { inApp: true, email: true, whatsapp: false },
  includeInMorningSummary: false, acknowledgementTargetMinutes: 20, reminderIntervalMinutes: 10,
  maximumEscalationLevel: 3, evidenceRequiredOutcomes: ['confirmed'],
  effectiveFrom: '2099-01-01T00:00:00.000Z', changeReason: 'Tune ack targets', actorUserId: USER,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.transaction.mockImplementation(async (work: (txn: unknown) => Promise<unknown>) => work({
    query: db.txnQuery, queryOne: db.txnQueryOne,
  }));
});

describe('incident rule settings', () => {
  it('loads the rule whose effective interval covers the as-of instant', async () => {
    db.queryOne.mockResolvedValue(ruleRow);

    await expect(loadEffectiveIncidentRule('late', '2026-08-13T00:00:00.000Z'))
      .resolves.toMatchObject({ version: 1, incidentType: 'late' });
    expect(db.queryOne.mock.calls[0]?.[0]).toContain('effective_from <= $2::timestamptz');
    expect(db.queryOne.mock.calls[0]?.[1]).toEqual(['late', '2026-08-13T00:00:00.000Z']);
  });

  it('returns a disabled rule without filtering it out', async () => {
    db.queryOne.mockResolvedValue({ ...ruleRow, enabled: false });

    await expect(loadEffectiveIncidentRule('late', '2026-08-13T00:00:00.000Z'))
      .resolves.toMatchObject({ enabled: false });
  });

  it('returns null when no rule interval covers the instant', async () => {
    db.queryOne.mockResolvedValue(null);

    await expect(loadEffectiveIncidentRule('late', '2020-01-01T00:00:00.000Z')).resolves.toBeNull();
  });

  it('lists rule history newest version first', async () => {
    db.query.mockResolvedValue([{ ...ruleRow, version: 2 }, ruleRow]);

    await expect(listIncidentRuleVersions('late')).resolves.toMatchObject([{ version: 2 }, { version: 1 }]);
    expect(db.query.mock.calls[0]?.[0]).toContain('ORDER BY version DESC');
    expect(db.query.mock.calls[0]?.[1]).toEqual(['late']);
  });

  it('locks the open version for the type, closes it, then inserts the next version atomically', async () => {
    db.txnQueryOne
      .mockResolvedValueOnce(ruleRow)
      .mockResolvedValueOnce({
        ...ruleRow, id: MEMBER_ID, version: 2,
        effective_from: changeRequest.effectiveFrom, acknowledgement_target_minutes: 20,
      });
    db.txnQuery.mockResolvedValue([]);

    await expect(versionIncidentRule(changeRequest)).resolves.toMatchObject({ version: 2, acknowledgementTargetMinutes: 20 });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.txnQueryOne.mock.calls[0]?.[0]).toContain('FOR UPDATE');
    expect(db.txnQueryOne.mock.calls[0]?.[1]).toEqual(['late']);
    expect(db.txnQuery.mock.calls[0]?.[0]).toContain('SET effective_to = $1::timestamptz');
    expect(db.txnQuery.mock.invocationCallOrder[0]).toBeLessThan(db.txnQueryOne.mock.invocationCallOrder[1]!);
  });

  it('rejects a change reason that is blank', async () => {
    await expect(versionIncidentRule({ ...changeRequest, changeReason: '   ' }))
      .rejects.toBeInstanceOf(IncidentSettingsValidationError);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects a non-positive acknowledgement target before opening a transaction', async () => {
    await expect(versionIncidentRule({ ...changeRequest, acknowledgementTargetMinutes: 0 }))
      .rejects.toBeInstanceOf(IncidentSettingsValidationError);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects a backdated activation before opening a transaction', async () => {
    await expect(versionIncidentRule({ ...changeRequest, effectiveFrom: '2020-01-01T00:00:00.000Z' }))
      .rejects.toBeInstanceOf(IncidentSettingsValidationError);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('throws when no open rule stream exists for the type', async () => {
    db.txnQueryOne.mockResolvedValueOnce(null);

    await expect(versionIncidentRule(changeRequest)).rejects.toBeInstanceOf(IncidentSettingsValidationError);
  });
});

describe('oversight membership', () => {
  const memberRow = { id: MEMBER_ID, user_id: USER, effective_from: '2026-08-01T00:00:00.000Z', effective_to: null, reason: null };

  it('lists only active members when requested', async () => {
    db.query.mockResolvedValue([memberRow]);

    await expect(listOversightMembers({ activeOnly: true })).resolves.toMatchObject([{ userId: USER, effectiveTo: null }]);
    expect(db.query.mock.calls[0]?.[0]).toContain('effective_to IS NULL');
  });

  it('lists full membership history when not restricted to active', async () => {
    db.query.mockResolvedValue([memberRow, { ...memberRow, id: 'x', effective_to: '2026-09-01T00:00:00.000Z' }]);

    await listOversightMembers();
    expect(db.query.mock.calls[0]?.[0]).not.toContain('WHERE');
  });

  it('adds an active membership', async () => {
    db.queryOne.mockResolvedValue(memberRow);

    await expect(addOversightMember({ userId: USER, actorUserId: USER })).resolves.toMatchObject({ userId: USER, effectiveTo: null });
  });

  it('rejects a duplicate active membership for the same user', async () => {
    db.queryOne.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));

    await expect(addOversightMember({ userId: USER, actorUserId: USER })).rejects.toBeInstanceOf(OversightMembershipConflictError);
  });

  it('ends a membership with an actor, reason, and end timestamp', async () => {
    db.queryOne.mockResolvedValue({ ...memberRow, effective_to: '2026-08-15T00:00:00.000Z', reason: 'Left the oversight team' });

    await expect(endOversightMembership(MEMBER_ID, USER, 'Left the oversight team'))
      .resolves.toMatchObject({ effectiveTo: '2026-08-15T00:00:00.000Z', reason: 'Left the oversight team' });
    expect(db.queryOne.mock.calls[0]?.[1]).toContain(USER);
    expect(db.queryOne.mock.calls[0]?.[1]).toContain('Left the oversight team');
  });

  it('rejects ending a membership without a reason', async () => {
    await expect(endOversightMembership(MEMBER_ID, USER, '   ')).rejects.toBeInstanceOf(IncidentSettingsValidationError);
    expect(db.queryOne).not.toHaveBeenCalled();
  });

  it('reports not-found when no active membership matches the id', async () => {
    db.queryOne.mockResolvedValue(null);

    await expect(endOversightMembership(MEMBER_ID, USER, 'Role change')).rejects.toBeInstanceOf(OversightMembershipNotFoundError);
  });
});
