import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), transaction: vi.fn(), txnQuery: vi.fn(), txnQueryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: db.query, queryOne: db.queryOne, transaction: db.transaction }));

const reviewScope = vi.hoisted(() => ({ resolveIncidentScope: vi.fn(), isProjectOwnedByScope: vi.fn() }));
vi.mock('../../reviewScope', () => reviewScope);

const reviewQueries = vi.hoisted(() => ({ getIncidentCore: vi.fn() }));
vi.mock('../../reviewQueries', () => reviewQueries);

const settingsRepo = vi.hoisted(() => ({ getEffectiveDriverInputSettings: vi.fn() }));
vi.mock('../settingsRepository', () => settingsRepo);

const writeRepo = vi.hoisted(() => ({ insertInputRequest: vi.fn() }));
vi.mock('../driverInputWriteRepository', () => writeRepo);

const notifications = vi.hoisted(() => ({ notifyDriverInputRequested: vi.fn() }));
vi.mock('../driverNotifications', () => notifications);

import { IncidentNotFoundError } from '../../incidentRepository';
import {
  DriverInputAccessDeniedError,
  DriverInputRequestConflictError,
  DriverInputRequestValidationError,
  requestDriverInput,
} from '../requestInputService';

const INCIDENT = '22222222-2222-4222-8222-222222222222';
const STAFF = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const DRIVER_USER = '44444444-4444-4444-8444-444444444444';
const MANAGER = '66666666-6666-4666-8666-666666666666';

const actorScope = { userId: MANAGER, staffId: null, role: 'manager' };

const command = { incidentId: INCIDENT, guidance: '  Please explain the late start  ', idempotencyKey: 'req-key-1' };

const settingsRow = {
  version: 1, effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: null,
  responseWindowWorkdays: 2, postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
  recentWindowDays: 90, historyWindowDays: 365,
  enabledConcernCategories: ['assignment_error', 'site_error', 'vehicle_error', 'geofence_error', 'other'],
  evidenceAllowedMimeTypes: ['image/jpeg'], evidenceMaxBytes: 15728640,
  driverInputRequestedChannels: { inApp: true, email: true, whatsapp: false },
  driverResponseReceivedChannels: { inApp: true, email: true, whatsapp: false },
};

const incidentCore = {
  id: INCIDENT, incidentReference: 'INC-LATE-20260810-ABC123', incidentType: 'late', severity: 'high',
  lifecycleStatus: 'open', staffId: STAFF, staffName: 'A Driver', projectId: 'proj-1', projectName: 'Corridor A',
  operationalSiteName: 'Site 4', openedAt: '2026-08-10T08:05:00.000Z', conditionLastSeenAt: null, conditionClearedAt: null,
  escalationLevel: 0, nextEscalationAt: null, evidenceCount: 0, detectedAt: '2026-08-10T08:00:00.000Z',
  acknowledgedAt: null, acknowledgedBy: null, reviewStartedAt: null, reviewStartedBy: null,
  resolvedAt: null, resolvedBy: null, outcome: null, resolutionNote: null,
  evidenceSnapshot: {}, sourceEventId: null, linkedHsReference: null, linkedMaintenanceReference: null,
};

const lockedIncidentRow = { staff_id: STAFF, lifecycle_status: 'open', resolved_at: null };
const requestRecord = {
  id: REQUEST_ID, incidentId: INCIDENT, guidance: 'Please explain the late start', requestedAt: '2026-08-13T09:00:00.000Z',
  respondBy: '2099-08-17T21:59:59.999Z', supersededAt: null, closedAt: null, closureReason: null,
  deliveryAttemptedCount: 0, deliveryAcceptedCount: 0, deliveryFailedCount: 0,
};

function setHappyPathMocks(): void {
  reviewScope.resolveIncidentScope.mockResolvedValue({ unrestricted: true, pmUserId: MANAGER, pmStaffId: null });
  reviewScope.isProjectOwnedByScope.mockResolvedValue(true);
  reviewQueries.getIncidentCore.mockResolvedValue(incidentCore);
  settingsRepo.getEffectiveDriverInputSettings.mockResolvedValue(settingsRow);
  db.transaction.mockImplementation(async (work: (txn: unknown) => Promise<unknown>) => work({ query: db.txnQuery, queryOne: db.txnQueryOne }));
  db.txnQueryOne.mockResolvedValue(lockedIncidentRow);
  db.txnQuery.mockResolvedValue([]);
  writeRepo.insertInputRequest.mockResolvedValue({ record: requestRecord, created: true });
  notifications.notifyDriverInputRequested.mockResolvedValue({ delivered: 1, suppressed: 0, failed: 0 });
  db.queryOne.mockResolvedValue({ user_id: DRIVER_USER });
  db.query.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setHappyPathMocks();
});

describe('requestDriverInput — validation', () => {
  it('rejects a malformed incident id', async () => {
    await expect(requestDriverInput({ ...command, incidentId: 'not-a-uuid' }, actorScope))
      .rejects.toBeInstanceOf(DriverInputRequestValidationError);
  });

  it('rejects a blank idempotency key', async () => {
    await expect(requestDriverInput({ ...command, idempotencyKey: '   ' }, actorScope))
      .rejects.toBeInstanceOf(DriverInputRequestValidationError);
  });

  it('normalizes whitespace-only guidance to null', async () => {
    await requestDriverInput({ ...command, guidance: '   ' }, actorScope);

    expect(writeRepo.insertInputRequest.mock.calls[0]?.[0].guidance).toBeNull();
  });

  it('trims real guidance before persisting', async () => {
    await requestDriverInput(command, actorScope);

    expect(writeRepo.insertInputRequest.mock.calls[0]?.[0].guidance).toBe('Please explain the late start');
  });

  it('rejects a respondBy that is not a valid ISO instant', async () => {
    await expect(requestDriverInput({ ...command, respondBy: 'tomorrow' }, actorScope))
      .rejects.toBeInstanceOf(DriverInputRequestValidationError);
  });

  it('rejects a respondBy that is not in the future', async () => {
    await expect(requestDriverInput({ ...command, respondBy: '2000-01-01T00:00:00.000Z' }, actorScope))
      .rejects.toBeInstanceOf(DriverInputRequestValidationError);
  });

  it('accepts a valid custom respondBy and uses it verbatim', async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await requestDriverInput({ ...command, respondBy: future }, actorScope);

    expect(writeRepo.insertInputRequest.mock.calls[0]?.[0].respondBy).toBe(future);
  });

  it('computes a default respondBy from settings.responseWindowWorkdays when none is supplied', async () => {
    await requestDriverInput(command, actorScope);

    expect(writeRepo.insertInputRequest.mock.calls[0]?.[0].respondBy).toEqual(expect.any(String));
    expect(db.txnQueryOne).toHaveBeenCalled();
  });
});

describe('requestDriverInput — permission and scope', () => {
  it('throws access denied when the actor lacks fleet.incidents edit permission', async () => {
    reviewScope.resolveIncidentScope.mockResolvedValue(null);

    await expect(requestDriverInput(command, actorScope)).rejects.toBeInstanceOf(DriverInputAccessDeniedError);
    expect(writeRepo.insertInputRequest).not.toHaveBeenCalled();
  });

  it('allows a PM who owns the incident project (restricted scope)', async () => {
    reviewScope.resolveIncidentScope.mockResolvedValue({ unrestricted: false, pmUserId: MANAGER, pmStaffId: null });
    reviewScope.isProjectOwnedByScope.mockResolvedValue(true);

    await expect(requestDriverInput(command, actorScope)).resolves.toBeDefined();
    expect(reviewScope.isProjectOwnedByScope).toHaveBeenCalledWith({ unrestricted: false, pmUserId: MANAGER, pmStaffId: null }, 'proj-1');
  });

  it('rejects a restricted PM who does not own the incident project (cross-project)', async () => {
    reviewScope.resolveIncidentScope.mockResolvedValue({ unrestricted: false, pmUserId: MANAGER, pmStaffId: null });
    reviewScope.isProjectOwnedByScope.mockResolvedValue(false);

    await expect(requestDriverInput(command, actorScope)).rejects.toBeInstanceOf(DriverInputAccessDeniedError);
    expect(writeRepo.insertInputRequest).not.toHaveBeenCalled();
  });

  it('allows unrestricted oversight scope regardless of project ownership', async () => {
    reviewScope.resolveIncidentScope.mockResolvedValue({ unrestricted: true, pmUserId: MANAGER, pmStaffId: null });

    await expect(requestDriverInput(command, actorScope)).resolves.toBeDefined();
    expect(reviewScope.isProjectOwnedByScope).not.toHaveBeenCalled();
  });

  it('throws not found when the incident does not exist', async () => {
    reviewQueries.getIncidentCore.mockResolvedValue(null);

    await expect(requestDriverInput(command, actorScope)).rejects.toBeInstanceOf(IncidentNotFoundError);
  });

  it('throws a validation error when the incident has no linked driver', async () => {
    reviewQueries.getIncidentCore.mockResolvedValue({ ...incidentCore, staffId: null });

    await expect(requestDriverInput(command, actorScope)).rejects.toBeInstanceOf(DriverInputRequestValidationError);
    expect(writeRepo.insertInputRequest).not.toHaveBeenCalled();
  });
});

describe('requestDriverInput — terminal / post-closure policy', () => {
  it('rejects requesting input on a closed incident when post-closure response is disabled', async () => {
    db.txnQueryOne.mockResolvedValue({ staff_id: STAFF, lifecycle_status: 'resolved', resolved_at: '2026-08-01T00:00:00.000Z' });
    settingsRepo.getEffectiveDriverInputSettings.mockResolvedValue({ ...settingsRow, postClosureResponseEnabled: false });

    await expect(requestDriverInput(command, actorScope)).rejects.toBeInstanceOf(DriverInputRequestConflictError);
  });

  it('rejects requesting input once the post-closure window has passed', async () => {
    db.txnQueryOne.mockResolvedValue({ staff_id: STAFF, lifecycle_status: 'resolved', resolved_at: '2000-01-01T00:00:00.000Z' });
    settingsRepo.getEffectiveDriverInputSettings.mockResolvedValue({ ...settingsRow, postClosureResponseEnabled: true, postClosureResponseWindowDays: 5 });

    await expect(requestDriverInput(command, actorScope)).rejects.toBeInstanceOf(DriverInputRequestConflictError);
  });

  it('allows requesting input on a closed incident within an enabled post-closure window', async () => {
    const resolvedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    db.txnQueryOne.mockResolvedValue({ staff_id: STAFF, lifecycle_status: 'resolved', resolved_at: resolvedAt });
    settingsRepo.getEffectiveDriverInputSettings.mockResolvedValue({ ...settingsRow, postClosureResponseEnabled: true, postClosureResponseWindowDays: 5 });

    await expect(requestDriverInput(command, actorScope)).resolves.toBeDefined();
  });
});

describe('requestDriverInput — supersede, notification order, and re-request history', () => {
  it('supersedes the prior open request when this is a genuinely new request', async () => {
    await requestDriverInput(command, actorScope);

    const supersedeCall = db.txnQuery.mock.calls.find(([text]: [string]) => text.includes('SET superseded_at'));
    expect(supersedeCall).toBeDefined();
    expect(supersedeCall?.[1]).toEqual([INCIDENT, expect.any(String), REQUEST_ID]);
  });

  it('inserts a shared_with_driver guidance action for a new request', async () => {
    await requestDriverInput(command, actorScope);

    const actionCall = db.txnQuery.mock.calls.find(([text]: [string]) => text.includes('fleet_operational_incident_actions'));
    expect(actionCall).toBeDefined();
    expect(actionCall?.[0]).toContain("'shared_with_driver'");
  });

  it('does not supersede or insert a new action on an idempotent duplicate retry', async () => {
    writeRepo.insertInputRequest.mockResolvedValue({ record: requestRecord, created: false });

    await requestDriverInput(command, actorScope);

    expect(db.txnQuery).not.toHaveBeenCalled();
  });

  it('calls the transaction before sending any notification', async () => {
    const callOrder: string[] = [];
    db.transaction.mockImplementation(async (work: (txn: unknown) => Promise<unknown>) => {
      callOrder.push('transaction');
      return work({ query: db.txnQuery, queryOne: db.txnQueryOne });
    });
    notifications.notifyDriverInputRequested.mockImplementation(async () => {
      callOrder.push('notify');
      return { delivered: 1, suppressed: 0, failed: 0 };
    });

    await requestDriverInput(command, actorScope);

    expect(callOrder).toEqual(['transaction', 'notify']);
  });

  it('isolates a notification failure — the request result still returns the committed request', async () => {
    notifications.notifyDriverInputRequested.mockResolvedValue({ delivered: 0, suppressed: 0, failed: 1 });

    const result = await requestDriverInput(command, actorScope);

    expect(result.inputRequestId).toBe(REQUEST_ID);
    expect(result.notification).toEqual({ delivered: 0, suppressed: 0, failed: 1 });
  });

  it('persists delivery counts onto the request row after notifying', async () => {
    await requestDriverInput(command, actorScope);

    const deliveryCall = db.query.mock.calls.find(([text]: [string]) => text.includes('delivery_attempted_count'));
    expect(deliveryCall).toBeDefined();
    expect(deliveryCall?.[1]).toEqual([REQUEST_ID, 1, 0]);
  });

  it('resolves and passes the linked driver user id to the notifier', async () => {
    await requestDriverInput(command, actorScope);

    expect(notifications.notifyDriverInputRequested).toHaveBeenCalledWith(
      expect.objectContaining({ inputRequestId: REQUEST_ID }),
      expect.objectContaining({ incidentId: INCIDENT, incidentReference: 'INC-LATE-20260810-ABC123' }),
      DRIVER_USER,
    );
  });

  it('passes null to the notifier when the driver has no linked user account', async () => {
    db.queryOne.mockResolvedValue(null);

    await requestDriverInput(command, actorScope);

    expect(notifications.notifyDriverInputRequested).toHaveBeenCalledWith(expect.anything(), expect.anything(), null);
  });

  it('returns the derived driverInputState alongside the result', async () => {
    const result = await requestDriverInput(command, actorScope);

    expect(result.driverInputState).toBe('requested');
  });
});
