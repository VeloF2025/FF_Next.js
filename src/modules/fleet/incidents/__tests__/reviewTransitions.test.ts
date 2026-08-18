import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TxnClient } from '@/lib/db-pool';

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: db.query, queryOne: db.queryOne, transaction: db.transaction }));

const repo = vi.hoisted(() => ({ acknowledgeIncident: vi.fn(), insertIncidentAction: vi.fn() }));
vi.mock('../incidentRepository', async () => {
  const actual = await vi.importActual<typeof import('../incidentRepository')>('../incidentRepository');
  return { ...actual, acknowledgeIncident: repo.acknowledgeIncident, insertIncidentAction: repo.insertIncidentAction };
});

import { IncidentNotFoundError } from '../incidentRepository';
import {
  IncidentTransitionConflictError,
  IncidentTransitionForbiddenError,
  IncidentTransitionValidationError,
  runBulkAcknowledge,
  runIncidentTransition,
} from '../reviewTransitions';
import type { IncidentTransitionRequest } from '../types';
import type { IncidentScopeFilter } from '../reviewScope';

const INCIDENT = '11111111-1111-4111-8111-111111111111';
const OTHER_INCIDENT = '44444444-4444-4444-8444-444444444444';
const USER = '22222222-2222-4222-8222-222222222222';
const STAFF = '33333333-3333-4333-8333-333333333333';

function fakeTxn(): TxnClient & { query: ReturnType<typeof vi.fn>; queryOne: ReturnType<typeof vi.fn> } {
  const query = vi.fn(); const queryOne = vi.fn();
  return { query, queryOne, client: {} as never } as unknown as TxnClient & { query: typeof query; queryOne: typeof queryOne };
}

const unrestrictedScope: IncidentScopeFilter = { unrestricted: true, pmUserId: USER, pmStaffId: STAFF };

function lockedRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    lifecycle_status: 'acknowledged', escalation_level: 0, incident_reference: 'INC-LATE-20260813-ABC123',
    incident_type: 'late', severity: 'high', project_id: null, staff_name_snapshot: 'Jane', incident_rule_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.transaction.mockImplementation(async (cb: (txn: TxnClient) => unknown) => cb(fakeTxn()));
  repo.insertIncidentAction.mockResolvedValue({ id: 'action-1' });
});

function baseRequest(overrides: Partial<IncidentTransitionRequest> = {}): IncidentTransitionRequest {
  return { incidentId: INCIDENT, actionType: 'commented', actorUserId: USER, note: 'note', ...overrides };
}

describe('acknowledgement transitions', () => {
  it('delegates to incidentRepository.acknowledgeIncident and returns its result', async () => {
    repo.acknowledgeIncident.mockResolvedValue({ outcome: 'acknowledged', lifecycleStatus: 'acknowledged', actionId: 'ack-1' });
    const outcome = await runIncidentTransition(baseRequest({ actionType: 'acknowledged', note: null }));
    expect(outcome.result).toEqual({ incidentId: INCIDENT, lifecycleStatus: 'acknowledged', actionId: 'ack-1' });
  });

  it('returns the current state idempotently on a later acknowledgement', async () => {
    repo.acknowledgeIncident.mockResolvedValue({ outcome: 'already_acknowledged', lifecycleStatus: 'under_review', actionId: null });
    const txn = fakeTxn(); txn.queryOne.mockResolvedValue({ id: 'ack-original' });
    db.transaction.mockImplementation(async (cb: (t: TxnClient) => unknown) => cb(txn));
    const outcome = await runIncidentTransition(baseRequest({ actionType: 'acknowledged', note: null }));
    expect(outcome.result).toEqual({ incidentId: INCIDENT, lifecycleStatus: 'under_review', actionId: 'ack-original' });
  });

  it('raises a conflict when acknowledging an already-terminal incident', async () => {
    repo.acknowledgeIncident.mockResolvedValue({ outcome: 'terminal_conflict', lifecycleStatus: 'resolved', actionId: null });
    await expect(runIncidentTransition(baseRequest({ actionType: 'acknowledged', note: null })))
      .rejects.toBeInstanceOf(IncidentTransitionConflictError);
  });
});

describe('review_started transitions', () => {
  it('requires the incident to already be acknowledged', async () => {
    const txn = fakeTxn(); txn.queryOne.mockResolvedValue(lockedRow({ lifecycle_status: 'open' }));
    db.transaction.mockImplementation(async (cb: (t: TxnClient) => unknown) => cb(txn));
    await expect(runIncidentTransition(baseRequest({ actionType: 'review_started', note: null })))
      .rejects.toBeInstanceOf(IncidentTransitionConflictError);
  });

  it('moves an acknowledged incident into under_review', async () => {
    const txn = fakeTxn(); txn.queryOne.mockResolvedValue(lockedRow({ lifecycle_status: 'acknowledged' }));
    db.transaction.mockImplementation(async (cb: (t: TxnClient) => unknown) => cb(txn));
    const outcome = await runIncidentTransition(baseRequest({ actionType: 'review_started', note: null }));
    expect(outcome.result).toMatchObject({ lifecycleStatus: 'under_review', actionId: 'action-1' });
  });

  it('is idempotent when already under review', async () => {
    const txn = fakeTxn();
    txn.queryOne.mockResolvedValueOnce(lockedRow({ lifecycle_status: 'under_review' })).mockResolvedValueOnce({ id: 'review-original' });
    db.transaction.mockImplementation(async (cb: (t: TxnClient) => unknown) => cb(txn));
    const outcome = await runIncidentTransition(baseRequest({ actionType: 'review_started', note: null }));
    expect(outcome.result).toMatchObject({ lifecycleStatus: 'under_review', actionId: 'review-original' });
  });

  it('raises 409 on a terminal incident', async () => {
    const txn = fakeTxn(); txn.queryOne.mockResolvedValue(lockedRow({ lifecycle_status: 'dismissed' }));
    db.transaction.mockImplementation(async (cb: (t: TxnClient) => unknown) => cb(txn));
    await expect(runIncidentTransition(baseRequest({ actionType: 'review_started', note: null })))
      .rejects.toBeInstanceOf(IncidentTransitionConflictError);
  });
});

describe('commented transitions', () => {
  it('allows a comment on any non-terminal incident', async () => {
    const txn = fakeTxn(); txn.queryOne.mockResolvedValue(lockedRow({ lifecycle_status: 'open' }));
    db.transaction.mockImplementation(async (cb: (t: TxnClient) => unknown) => cb(txn));
    const outcome = await runIncidentTransition(baseRequest({ actionType: 'commented', note: 'checked in' }));
    expect(outcome.result.lifecycleStatus).toBe('open');
  });

  it('blocks a comment on a terminal incident', async () => {
    const txn = fakeTxn(); txn.queryOne.mockResolvedValue(lockedRow({ lifecycle_status: 'resolved' }));
    db.transaction.mockImplementation(async (cb: (t: TxnClient) => unknown) => cb(txn));
    await expect(runIncidentTransition(baseRequest({ actionType: 'commented', note: 'too late' })))
      .rejects.toBeInstanceOf(IncidentTransitionConflictError);
  });

  it('raises IncidentNotFoundError when the row does not exist', async () => {
    const txn = fakeTxn(); txn.queryOne.mockResolvedValue(null);
    db.transaction.mockImplementation(async (cb: (t: TxnClient) => unknown) => cb(txn));
    await expect(runIncidentTransition(baseRequest({ actionType: 'commented', note: 'x' })))
      .rejects.toBeInstanceOf(IncidentNotFoundError);
  });
});

describe('resolved/dismissed transitions', () => {
  function underReviewTxn(ruleRow: Record<string, unknown> | null = null, evidenceCount = '1') {
    const txn = fakeTxn();
    txn.queryOne.mockImplementation(async (text: string) => {
      if (text.includes('FOR UPDATE')) return lockedRow({ lifecycle_status: 'under_review', incident_rule_id: ruleRow ? 'rule-1' : null });
      if (text.includes('evidence_required_outcomes')) return ruleRow;
      if (text.includes('fleet_operational_incident_evidence')) return { count: evidenceCount };
      if (text.includes('incident_reference')) return { id: OTHER_INCIDENT };
      return null;
    });
    return txn;
  }

  it('requires under_review before resolving or dismissing', async () => {
    const txn = fakeTxn(); txn.queryOne.mockResolvedValue(lockedRow({ lifecycle_status: 'acknowledged' }));
    db.transaction.mockImplementation(async (cb: (t: TxnClient) => unknown) => cb(txn));
    await expect(runIncidentTransition(baseRequest({ actionType: 'resolved', note: 'ok', outcome: 'confirmed' })))
      .rejects.toBeInstanceOf(IncidentTransitionConflictError);
  });

  it('raises 409 when the incident is already terminal', async () => {
    const txn = fakeTxn(); txn.queryOne.mockResolvedValue(lockedRow({ lifecycle_status: 'dismissed' }));
    db.transaction.mockImplementation(async (cb: (t: TxnClient) => unknown) => cb(txn));
    await expect(runIncidentTransition(baseRequest({ actionType: 'dismissed', note: 'ok', outcome: 'false_positive' })))
      .rejects.toBeInstanceOf(IncidentTransitionConflictError);
  });

  it('requires a valid linked incident for a duplicate outcome', async () => {
    const txn = underReviewTxn();
    txn.queryOne.mockImplementation(async (text: string) => {
      if (text.includes('FOR UPDATE')) return lockedRow({ lifecycle_status: 'under_review' });
      if (text.includes('incident_reference')) return null;
      return null;
    });
    db.transaction.mockImplementation(async (cb: (t: TxnClient) => unknown) => cb(txn));
    await expect(runIncidentTransition(baseRequest({
      actionType: 'dismissed', note: 'dup', outcome: 'duplicate', linkedIncidentReference: 'INC-BOGUS',
    }))).rejects.toBeInstanceOf(IncidentTransitionValidationError);
  });

  it('requires at least one evidence attachment when the incident rule requires it for the outcome', async () => {
    const txn = underReviewTxn({ evidence_required_outcomes: ['confirmed'] }, '0');
    db.transaction.mockImplementation(async (cb: (t: TxnClient) => unknown) => cb(txn));
    await expect(runIncidentTransition(baseRequest({ actionType: 'resolved', note: 'ok', outcome: 'confirmed' })))
      .rejects.toBeInstanceOf(IncidentTransitionValidationError);
  });

  it('resolves successfully and returns resolution-notification input for the caller to send after commit', async () => {
    const txn = underReviewTxn({ evidence_required_outcomes: [] }, '0');
    db.transaction.mockImplementation(async (cb: (t: TxnClient) => unknown) => cb(txn));
    const outcome = await runIncidentTransition(baseRequest({ actionType: 'resolved', note: 'Reviewed and valid', outcome: 'confirmed' }));
    expect(outcome.result).toMatchObject({ lifecycleStatus: 'resolved', actionId: 'action-1' });
    expect(outcome.notify).toMatchObject({ incidentId: INCIDENT, outcome: 'confirmed', lifecycleStatus: 'resolved' });
  });
});

describe('runBulkAcknowledge', () => {
  it('validates every incident before mutating any', async () => {
    db.query.mockResolvedValue([
      { id: INCIDENT, lifecycle_status: 'open', project_id: null },
      { id: OTHER_INCIDENT, lifecycle_status: 'resolved', project_id: null },
    ]);
    await expect(runBulkAcknowledge([INCIDENT, OTHER_INCIDENT], USER, unrestrictedScope, null))
      .rejects.toBeInstanceOf(IncidentTransitionConflictError);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects when an id is not found before mutating any', async () => {
    db.query.mockResolvedValue([{ id: INCIDENT, lifecycle_status: 'open', project_id: null }]);
    await expect(runBulkAcknowledge([INCIDENT, OTHER_INCIDENT], USER, unrestrictedScope, null))
      .rejects.toBeInstanceOf(IncidentTransitionValidationError);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects when a restricted scope does not own one of the incidents', async () => {
    db.query.mockResolvedValueOnce([
      { id: INCIDENT, lifecycle_status: 'open', project_id: 'project-a' },
      { id: OTHER_INCIDENT, lifecycle_status: 'open', project_id: 'project-b' },
    ]);
    db.query.mockResolvedValueOnce([{ project_manager: USER }]);
    db.query.mockResolvedValueOnce([{ project_manager: 'someone-else' }]);
    const restrictedScope: IncidentScopeFilter = { unrestricted: false, pmUserId: USER, pmStaffId: STAFF };
    await expect(runBulkAcknowledge([INCIDENT, OTHER_INCIDENT], USER, restrictedScope, null))
      .rejects.toBeInstanceOf(IncidentTransitionForbiddenError);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('acknowledges every incident once all pass validation', async () => {
    db.query.mockResolvedValue([
      { id: INCIDENT, lifecycle_status: 'open', project_id: null },
      { id: OTHER_INCIDENT, lifecycle_status: 'open', project_id: null },
    ]);
    repo.acknowledgeIncident
      .mockResolvedValueOnce({ outcome: 'acknowledged', lifecycleStatus: 'acknowledged', actionId: 'a1' })
      .mockResolvedValueOnce({ outcome: 'acknowledged', lifecycleStatus: 'acknowledged', actionId: 'a2' });
    const outcome = await runBulkAcknowledge([INCIDENT, OTHER_INCIDENT], USER, unrestrictedScope, null);
    expect(outcome.results).toEqual([
      { incidentId: INCIDENT, lifecycleStatus: 'acknowledged', actionId: 'a1' },
      { incidentId: OTHER_INCIDENT, lifecycleStatus: 'acknowledged', actionId: 'a2' },
    ]);
    expect(db.transaction).toHaveBeenCalledTimes(2);
  });
});
