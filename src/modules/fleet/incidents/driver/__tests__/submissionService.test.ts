import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ transaction: vi.fn(), txnQuery: vi.fn(), txnQueryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ transaction: db.transaction }));

const driverInputRepo = vi.hoisted(() => ({
  lockIncidentForDriver: vi.fn(), findCurrentInputRequest: vi.fn(), neutralIncidentLabel: vi.fn((type: string) => `neutral:${type}`),
}));
vi.mock('../driverInputRepository', () => driverInputRepo);

const writeRepo = vi.hoisted(() => ({ insertDriverSubmission: vi.fn() }));
vi.mock('../driverInputWriteRepository', () => writeRepo);

const incidentService = vi.hoisted(() => ({ computeResponseEligibility: vi.fn() }));
vi.mock('../driverIncidentService', () => incidentService);

const reviewQueries = vi.hoisted(() => ({ getIncidentCore: vi.fn() }));
vi.mock('../../reviewQueries', () => reviewQueries);

const recipientService = vi.hoisted(() => ({ resolveIncidentRecipients: vi.fn() }));
vi.mock('../../recipientService', () => recipientService);

const notifications = vi.hoisted(() => ({ notifyDriverResponseReceived: vi.fn() }));
vi.mock('../driverNotifications', () => notifications);

const settingsRepo = vi.hoisted(() => ({ getEffectiveDriverInputSettings: vi.fn() }));
vi.mock('../settingsRepository', () => settingsRepo);

import { IncidentNotFoundError } from '../../incidentRepository';
import { DriverSubmissionNotEligibleError, DriverSubmissionValidationError, submitDriverResponse } from '../submissionService';

const STAFF = '11111111-1111-4111-8111-111111111111';
const INCIDENT = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const SUBMISSION_ID = '55555555-5555-4555-8555-555555555555';
const MANAGER = '66666666-6666-4666-8666-666666666666';

const command = {
  incidentId: INCIDENT, submissionKind: 'response' as const, explanation: '  I was on site at the time  ',
  concernCategory: null, idempotencyKey: 'sub-key-1',
};

const settingsRow = {
  version: 1, effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: null,
  responseWindowWorkdays: 2, postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
  recentWindowDays: 90, historyWindowDays: 365,
  enabledConcernCategories: ['assignment_error', 'site_error', 'vehicle_error', 'geofence_error', 'other'],
  evidenceAllowedMimeTypes: ['image/jpeg'], evidenceMaxBytes: 15728640,
  driverInputRequestedChannels: { inApp: true, email: true, whatsapp: false },
  driverResponseReceivedChannels: { inApp: true, email: true, whatsapp: false },
};

const lockedIncident = { id: INCIDENT, staffId: STAFF, lifecycleStatus: 'open', terminalAt: null };
const requestRecord = {
  id: REQUEST_ID, incidentId: INCIDENT, guidance: null, requestedAt: '2026-08-13T09:00:00.000Z',
  respondBy: '2099-08-17T21:59:59.999Z', supersededAt: null, closedAt: null, closureReason: null,
  deliveryAttemptedCount: 0, deliveryAcceptedCount: 0, deliveryFailedCount: 0,
};
const submissionRecord = {
  id: SUBMISSION_ID, incidentId: INCIDENT, inputRequestId: null, staffId: STAFF, submissionKind: 'response' as const,
  explanation: 'I was on site at the time', concernCategory: null, idempotencyKey: 'sub-key-1', createdAt: '2026-08-15T10:00:00.000Z',
};
const incidentCore = {
  id: INCIDENT, incidentReference: 'INC-LATE-20260810-ABC123', incidentType: 'late', severity: 'high',
  lifecycleStatus: 'open', staffId: STAFF, staffName: 'A Driver', projectId: 'proj-1', projectName: 'Corridor A',
  operationalSiteName: 'Site 4', openedAt: '2026-08-10T08:05:00.000Z', resolvedAt: null,
};

function setHappyPathMocks(): void {
  settingsRepo.getEffectiveDriverInputSettings.mockResolvedValue(settingsRow);
  db.transaction.mockImplementation(async (work: (txn: unknown) => Promise<unknown>) => work({ query: db.txnQuery, queryOne: db.txnQueryOne }));
  driverInputRepo.lockIncidentForDriver.mockResolvedValue(lockedIncident);
  driverInputRepo.findCurrentInputRequest.mockResolvedValue(null);
  incidentService.computeResponseEligibility.mockReturnValue({ eligible: true, reason: null });
  writeRepo.insertDriverSubmission.mockResolvedValue({ record: submissionRecord, created: true });
  db.txnQuery.mockResolvedValue([]);
  reviewQueries.getIncidentCore.mockResolvedValue(incidentCore);
  recipientService.resolveIncidentRecipients.mockResolvedValue({ userIds: [MANAGER], failed: false });
  notifications.notifyDriverResponseReceived.mockResolvedValue({ delivered: 1, suppressed: 0, failed: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  setHappyPathMocks();
});

describe('submitDriverResponse — validation', () => {
  it('rejects a malformed incident id', async () => {
    await expect(submitDriverResponse({ ...command, incidentId: 'not-a-uuid' }, STAFF)).rejects.toBeInstanceOf(DriverSubmissionValidationError);
    expect(writeRepo.insertDriverSubmission).not.toHaveBeenCalled();
  });

  it('rejects an unrecognized submissionKind', async () => {
    await expect(submitDriverResponse({ ...command, submissionKind: 'note' as never }, STAFF)).rejects.toBeInstanceOf(DriverSubmissionValidationError);
  });

  it('rejects a blank explanation', async () => {
    await expect(submitDriverResponse({ ...command, explanation: '   ' }, STAFF)).rejects.toBeInstanceOf(DriverSubmissionValidationError);
  });

  it('rejects an explanation over the length limit', async () => {
    await expect(submitDriverResponse({ ...command, explanation: 'x'.repeat(4001) }, STAFF)).rejects.toBeInstanceOf(DriverSubmissionValidationError);
  });

  it('rejects a blank idempotency key', async () => {
    await expect(submitDriverResponse({ ...command, idempotencyKey: '  ' }, STAFF)).rejects.toBeInstanceOf(DriverSubmissionValidationError);
  });

  it('rejects an unrecognized concern category', async () => {
    await expect(submitDriverResponse({ ...command, concernCategory: 'bogus' as never }, STAFF)).rejects.toBeInstanceOf(DriverSubmissionValidationError);
  });

  it('rejects a recognized concern category that is not currently enabled', async () => {
    settingsRepo.getEffectiveDriverInputSettings.mockResolvedValue({ ...settingsRow, enabledConcernCategories: ['other'] });

    await expect(submitDriverResponse({ ...command, concernCategory: 'vehicle_error' }, STAFF)).rejects.toBeInstanceOf(DriverSubmissionValidationError);
    expect(writeRepo.insertDriverSubmission).not.toHaveBeenCalled();
  });

  it('trims the explanation before persisting', async () => {
    await submitDriverResponse(command, STAFF);

    expect(writeRepo.insertDriverSubmission.mock.calls[0]?.[0].explanation).toBe('I was on site at the time');
  });
});

describe('submitDriverResponse — ownership and existence', () => {
  it('throws IncidentNotFoundError when the incident does not belong to this staff member (same shape as a missing incident)', async () => {
    driverInputRepo.lockIncidentForDriver.mockResolvedValue(null);

    await expect(submitDriverResponse(command, STAFF)).rejects.toBeInstanceOf(IncidentNotFoundError);
    expect(writeRepo.insertDriverSubmission).not.toHaveBeenCalled();
  });

  it('a driver cannot reach another staff member\'s incident even when the request explicitly names it: the lock call is scoped by sessionStaffId, and a non-owning id yields the same not-found outcome', async () => {
    const OTHER_STAFF = '99999999-9999-4999-8999-999999999999';
    driverInputRepo.lockIncidentForDriver.mockImplementation(async (staffId: string) => (staffId === STAFF ? lockedIncident : null));

    await expect(submitDriverResponse(command, OTHER_STAFF)).rejects.toBeInstanceOf(IncidentNotFoundError);
    expect(driverInputRepo.lockIncidentForDriver).toHaveBeenCalledWith(OTHER_STAFF, INCIDENT, expect.anything());
    expect(writeRepo.insertDriverSubmission).not.toHaveBeenCalled();

    await expect(submitDriverResponse(command, STAFF)).resolves.toBeDefined();
  });
});

describe('submitDriverResponse — voluntary, requested, and follow-up', () => {
  it('accepts a voluntary response with no current request (inputRequestId null)', async () => {
    driverInputRepo.findCurrentInputRequest.mockResolvedValue(null);

    await submitDriverResponse(command, STAFF);

    expect(writeRepo.insertDriverSubmission.mock.calls[0]?.[0].inputRequestId).toBeNull();
  });

  it('links a requested response to the current open request id', async () => {
    driverInputRepo.findCurrentInputRequest.mockResolvedValue(requestRecord);

    await submitDriverResponse(command, STAFF);

    expect(writeRepo.insertDriverSubmission.mock.calls[0]?.[0].inputRequestId).toBe(REQUEST_ID);
  });

  it('accepts a follow_up submission kind', async () => {
    driverInputRepo.findCurrentInputRequest.mockResolvedValue(requestRecord);

    await submitDriverResponse({ ...command, submissionKind: 'follow_up' }, STAFF);

    expect(writeRepo.insertDriverSubmission.mock.calls[0]?.[0].submissionKind).toBe('follow_up');
  });
});

describe('submitDriverResponse — eligibility, response window, terminal policy, closure race', () => {
  it('rejects with the reason computeResponseEligibility returns, without inserting a submission', async () => {
    incidentService.computeResponseEligibility.mockReturnValue({ eligible: false, reason: 'expired' });

    const error = await submitDriverResponse(command, STAFF).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(DriverSubmissionNotEligibleError);
    expect((error as InstanceType<typeof DriverSubmissionNotEligibleError>).reason).toBe('expired');
    expect(writeRepo.insertDriverSubmission).not.toHaveBeenCalled();
  });

  it('rejects a closed incident with reason "closed"', async () => {
    incidentService.computeResponseEligibility.mockReturnValue({ eligible: false, reason: 'closed' });

    const error = await submitDriverResponse(command, STAFF).catch((err: unknown) => err);

    expect((error as InstanceType<typeof DriverSubmissionNotEligibleError>).reason).toBe('closed');
  });

  it('derives eligibility from the ROW-LOCKED terminal state, not a pre-lock read — simulating a concurrent closure racing with this submission', async () => {
    // The transaction's own lock returns an already-resolved incident, as if
    // another transaction closed it a moment earlier. The eligibility call
    // must be built from that locked value.
    driverInputRepo.lockIncidentForDriver.mockResolvedValue({ ...lockedIncident, terminalAt: '2026-08-15T09:00:00.000Z' });
    incidentService.computeResponseEligibility.mockReturnValue({ eligible: false, reason: 'closed' });

    await expect(submitDriverResponse(command, STAFF)).rejects.toBeInstanceOf(DriverSubmissionNotEligibleError);

    expect(incidentService.computeResponseEligibility).toHaveBeenCalledWith(
      expect.objectContaining({ incidentTerminalAt: '2026-08-15T09:00:00.000Z' }),
    );
  });
});

describe('submitDriverResponse — append-only audit row and immutability of incident fields', () => {
  it('inserts exactly one driver_submitted action row scoped to the actor staff id, not a user id', async () => {
    await submitDriverResponse(command, STAFF);

    const actionCall = db.txnQuery.mock.calls.find(([text]: [string]) => text.includes('fleet_operational_incident_actions'));
    expect(actionCall).toBeDefined();
    expect(actionCall?.[0]).toContain("'driver_submitted'");
    expect(actionCall?.[0]).toContain("'driver_response_received'");
    expect(actionCall?.[1]).toEqual([INCIDENT, STAFF, 'open']);
  });

  it('records before/after lifecycle_status as unchanged — a submission never sets lifecycle, outcome, or acknowledgement', async () => {
    driverInputRepo.lockIncidentForDriver.mockResolvedValue({ ...lockedIncident, lifecycleStatus: 'under_review' });

    await submitDriverResponse(command, STAFF);

    const actionCall = db.txnQuery.mock.calls.find(([text]: [string]) => text.includes('fleet_operational_incident_actions'));
    expect(actionCall?.[1]).toEqual([INCIDENT, STAFF, 'under_review']);
  });

  it('does not insert an action row on an idempotent duplicate replay', async () => {
    writeRepo.insertDriverSubmission.mockResolvedValue({ record: submissionRecord, created: false });

    await submitDriverResponse(command, STAFF);

    expect(db.txnQuery).not.toHaveBeenCalled();
  });
});

describe('submitDriverResponse — idempotency', () => {
  it('returns the existing submission id on a duplicate idempotency key (created: false)', async () => {
    writeRepo.insertDriverSubmission.mockResolvedValue({ record: submissionRecord, created: false });

    const result = await submitDriverResponse(command, STAFF);

    expect(result).toMatchObject({ submissionId: SUBMISSION_ID, created: false });
  });

  it('a different idempotency key on a second call appends independently (created: true both times)', async () => {
    const secondRecord = { ...submissionRecord, id: '77777777-7777-4777-8777-777777777777', idempotencyKey: 'sub-key-2' };
    writeRepo.insertDriverSubmission
      .mockResolvedValueOnce({ record: submissionRecord, created: true })
      .mockResolvedValueOnce({ record: secondRecord, created: true });

    const first = await submitDriverResponse(command, STAFF);
    const second = await submitDriverResponse({ ...command, idempotencyKey: 'sub-key-2' }, STAFF);

    expect(first.submissionId).toBe(SUBMISSION_ID);
    expect(second.submissionId).toBe('77777777-7777-4777-8777-777777777777');
    expect(first.submissionId).not.toBe(second.submissionId);
  });
});

describe('submitDriverResponse — manager notification after commit', () => {
  it('calls the transaction before sending any notification', async () => {
    const callOrder: string[] = [];
    db.transaction.mockImplementation(async (work: (txn: unknown) => Promise<unknown>) => {
      callOrder.push('transaction');
      return work({ query: db.txnQuery, queryOne: db.txnQueryOne });
    });
    notifications.notifyDriverResponseReceived.mockImplementation(async () => {
      callOrder.push('notify');
      return { delivered: 1, suppressed: 0, failed: 0 };
    });

    await submitDriverResponse(command, STAFF);

    expect(callOrder).toEqual(['transaction', 'notify']);
  });

  it('resolves recipients from the incident\'s project and notifies them all', async () => {
    recipientService.resolveIncidentRecipients.mockResolvedValue({ userIds: [MANAGER, 'other-manager'], failed: false });

    await submitDriverResponse(command, STAFF);

    expect(recipientService.resolveIncidentRecipients).toHaveBeenCalledWith('proj-1');
    expect(notifications.notifyDriverResponseReceived).toHaveBeenCalledWith(
      expect.objectContaining({ submissionId: SUBMISSION_ID, submissionKind: 'response' }),
      expect.objectContaining({ incidentId: INCIDENT, incidentReference: 'INC-LATE-20260810-ABC123' }),
      [MANAGER, 'other-manager'],
    );
  });

  it('isolates a notification failure — the submission result still returns the committed submission', async () => {
    notifications.notifyDriverResponseReceived.mockRejectedValue(new Error('notify down'));

    const result = await submitDriverResponse(command, STAFF);

    expect(result.submissionId).toBe(SUBMISSION_ID);
  });

  it('isolates a getIncidentCore failure after commit — still returns the committed submission', async () => {
    reviewQueries.getIncidentCore.mockRejectedValue(new Error('db down'));

    const result = await submitDriverResponse(command, STAFF);

    expect(result.submissionId).toBe(SUBMISSION_ID);
    expect(notifications.notifyDriverResponseReceived).not.toHaveBeenCalled();
  });
});

describe('submitDriverResponse — returned state', () => {
  it('returns a driverInputState of "responded" once a submission is accepted against a current request', async () => {
    driverInputRepo.findCurrentInputRequest.mockResolvedValue(requestRecord);

    const result = await submitDriverResponse(command, STAFF);

    expect(result.driverInputState).toBe('responded');
  });

  it('a voluntary submission with no current request keeps the state "not_requested" (deriveDriverInputState is request-relative; ./inputState.ts short-circuits to not_requested whenever currentRequest is null)', async () => {
    driverInputRepo.findCurrentInputRequest.mockResolvedValue(null);

    const result = await submitDriverResponse(command, STAFF);

    expect(result.driverInputState).toBe('not_requested');
  });
});
