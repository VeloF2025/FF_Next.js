import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ transaction: vi.fn(), txnQuery: vi.fn(), txnQueryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ transaction: db.transaction }));

const permissions = vi.hoisted(() => ({ userHasPermission: vi.fn() }));
vi.mock('@/lib/permissions', () => permissions);

const reviewScope = vi.hoisted(() => ({
  resolveIncidentScope: vi.fn(), isProjectOwnedByScope: vi.fn(), isActiveFibreFlowUser: vi.fn(),
}));
vi.mock('../../reviewScope', () => reviewScope);

const reviewQueries = vi.hoisted(() => ({ getIncidentCore: vi.fn() }));
vi.mock('../../reviewQueries', () => reviewQueries);

const settings = vi.hoisted(() => ({ getEffectiveAnalyticsRetentionSettings: vi.fn() }));
vi.mock('../../analytics/settingsRepository', () => settings);

const repo = vi.hoisted(() => ({
  listIncidentHolds: vi.fn(), listHoldActions: vi.fn(), lockHold: vi.fn(), insertHold: vi.fn(),
  recordHoldReview: vi.fn(), recordHoldRelease: vi.fn(), insertHoldAction: vi.fn(),
  FLEET_RETENTION_HOLDS_PERMISSION: 'fleet.retention-holds',
}));
vi.mock('../holdRepository', () => repo);

import { IncidentNotFoundError } from '../../incidentRepository';
import {
  RetentionHoldAccessDeniedError,
  RetentionHoldConflictError,
  RetentionHoldValidationError,
  createRetentionHold,
  listIncidentHoldsForViewer,
  releaseRetentionHold,
  reviewRetentionHold,
} from '../holdService';

const INCIDENT = '22222222-2222-4222-8222-222222222222';
const HOLD = '55555555-5555-4555-8555-555555555555';
const OWNER = '44444444-4444-4444-8444-444444444444';
const ADMIN = '66666666-6666-4666-8666-666666666666';
const PROJECT = '77777777-7777-4777-8777-777777777777';
const NOW = '2026-08-21T09:00:00.000Z';

const actor = { userId: ADMIN, staffId: null, role: 'admin' };

const policy = {
  version: 1, effectiveFrom: '2026-08-01T00:00:00.000Z', retentionMonths: 12, anonymityMinContributors: 5,
  recalculationWindowMonths: 3, retentionBatchSize: 100, maximumHoldReviewDays: 90,
  holdReviewReminderLeadDays: 14, aggregationRunHourSast: 1, aggregationRunMinuteSast: 0,
  retentionRunHourSast: 3, retentionRunMinuteSast: 30, aggregateFreshnessWarningHours: 36,
  retentionFreshnessWarningHours: 48,
  permittedHoldCategories: ['health_safety', 'accident', 'insurance', 'disciplinary', 'legal', 'other_approved'],
  metricVersion: 1, liveRetentionEnabled: false,
};

const activeHold = {
  id: HOLD, incidentId: INCIDENT, category: 'legal', status: 'active', reason: 'Litigation pending',
  ownerUserId: OWNER, holdStartAt: '2026-08-01T00:00:00.000Z', nextReviewAt: '2026-09-01T00:00:00.000Z',
  lastReviewedAt: null, releasedAt: null,
};

const command = {
  incidentId: INCIDENT, category: 'legal' as const, reason: '  Litigation pending  ',
  ownerUserId: OWNER, nextReviewAt: '2026-09-01T00:00:00.000Z',
};

function happyPath(): void {
  permissions.userHasPermission.mockResolvedValue(true);
  reviewScope.resolveIncidentScope.mockResolvedValue({ unrestricted: true, pmUserId: ADMIN, pmStaffId: null });
  reviewScope.isProjectOwnedByScope.mockResolvedValue(true);
  reviewScope.isActiveFibreFlowUser.mockResolvedValue(true);
  reviewQueries.getIncidentCore.mockResolvedValue({ id: INCIDENT, projectId: PROJECT, incidentReference: 'INC-1' });
  settings.getEffectiveAnalyticsRetentionSettings.mockResolvedValue(policy);
  db.transaction.mockImplementation(async (work: (txn: unknown) => Promise<unknown>) => work({ query: db.txnQuery, queryOne: db.txnQueryOne }));
  repo.insertHold.mockResolvedValue(activeHold);
  repo.lockHold.mockResolvedValue(activeHold);
  repo.recordHoldReview.mockResolvedValue({ ...activeHold, lastReviewedAt: NOW, nextReviewAt: '2026-10-01T00:00:00.000Z' });
  repo.recordHoldRelease.mockResolvedValue({ ...activeHold, status: 'released', releasedAt: NOW });
  repo.insertHoldAction.mockResolvedValue({ id: 'action-1' });
  repo.listIncidentHolds.mockResolvedValue([activeHold]);
  repo.listHoldActions.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  happyPath();
});

describe('createRetentionHold — authority', () => {
  it('creates the hold and its opening action in one transaction', async () => {
    const result = await createRetentionHold(command, actor, NOW);
    expect(result).toMatchObject({ id: HOLD, status: 'active' });
    expect(repo.insertHold).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      incidentId: INCIDENT, category: 'legal', reason: 'Litigation pending', ownerUserId: OWNER, createdBy: ADMIN,
    }));
    expect(repo.insertHoldAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actionType: 'created' }));
  });

  // Placing a hold keeps a named person's disciplinary record beyond the
  // standard period. Seeing the incident is not authority to do that.
  it('refuses a project manager who can view the incident but has no hold permission', async () => {
    permissions.userHasPermission.mockResolvedValue(false);
    await expect(createRetentionHold(command, { userId: 'pm', staffId: null, role: 'project_manager' }, NOW))
      .rejects.toBeInstanceOf(RetentionHoldAccessDeniedError);
    expect(repo.insertHold).not.toHaveBeenCalled();
  });

  it('requires the hold permission with the create action specifically', async () => {
    await createRetentionHold(command, actor, NOW);
    expect(permissions.userHasPermission).toHaveBeenCalledWith(ADMIN, 'fleet.retention-holds', 'create');
  });

  it('refuses an incident outside the actor incident scope', async () => {
    reviewScope.isProjectOwnedByScope.mockResolvedValue(false);
    await expect(createRetentionHold(command, actor, NOW)).rejects.toBeInstanceOf(RetentionHoldAccessDeniedError);
    expect(repo.insertHold).not.toHaveBeenCalled();
  });

  it('refuses when the actor has no fleet.incidents scope at all', async () => {
    reviewScope.resolveIncidentScope.mockResolvedValue(null);
    await expect(createRetentionHold(command, actor, NOW)).rejects.toBeInstanceOf(RetentionHoldAccessDeniedError);
  });

  it('404s an incident that does not exist', async () => {
    reviewQueries.getIncidentCore.mockResolvedValue(null);
    await expect(createRetentionHold(command, actor, NOW)).rejects.toBeInstanceOf(IncidentNotFoundError);
  });
});

describe('createRetentionHold — validation', () => {
  it('rejects a category the effective settings do not permit', async () => {
    settings.getEffectiveAnalyticsRetentionSettings.mockResolvedValue({ ...policy, permittedHoldCategories: ['legal'] });
    await expect(createRetentionHold({ ...command, category: 'disciplinary' }, actor, NOW))
      .rejects.toBeInstanceOf(RetentionHoldValidationError);
  });

  it('rejects a blank reason', async () => {
    await expect(createRetentionHold({ ...command, reason: '   ' }, actor, NOW))
      .rejects.toBeInstanceOf(RetentionHoldValidationError);
  });

  it('rejects an owner who is not an active FibreFlow user', async () => {
    reviewScope.isActiveFibreFlowUser.mockResolvedValue(false);
    await expect(createRetentionHold(command, actor, NOW)).rejects.toBeInstanceOf(RetentionHoldValidationError);
  });

  it('rejects a review date in the past', async () => {
    await expect(createRetentionHold({ ...command, nextReviewAt: '2026-08-20T00:00:00.000Z' }, actor, NOW))
      .rejects.toBeInstanceOf(RetentionHoldValidationError);
  });

  // An indefinite hold is how identifiable data quietly becomes permanent.
  it('rejects a review date beyond the configured maximum interval', async () => {
    await expect(createRetentionHold({ ...command, nextReviewAt: '2026-12-01T00:00:00.000Z' }, actor, NOW))
      .rejects.toBeInstanceOf(RetentionHoldValidationError);
  });

  it('accepts a review date exactly at the maximum interval', async () => {
    await expect(createRetentionHold({ ...command, nextReviewAt: '2026-11-19T09:00:00.000Z' }, actor, NOW)).resolves.toBeTruthy();
  });

  it('rejects a malformed review timestamp rather than coercing it', async () => {
    await expect(createRetentionHold({ ...command, nextReviewAt: '2026-09-31T00:00:00.000Z' }, actor, NOW))
      .rejects.toBeInstanceOf(RetentionHoldValidationError);
  });

  it('reports a duplicate active hold as a conflict, not a 500', async () => {
    repo.insertHold.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));
    await expect(createRetentionHold(command, actor, NOW)).rejects.toBeInstanceOf(RetentionHoldConflictError);
  });

  it('reports a vanished incident as not found, not a 500', async () => {
    repo.insertHold.mockRejectedValue(Object.assign(new Error('fk violation'), { code: '23503' }));
    await expect(createRetentionHold(command, actor, NOW)).rejects.toBeInstanceOf(IncidentNotFoundError);
  });
});

describe('reviewRetentionHold', () => {
  it('appends a reviewed action when the review date is not extended', async () => {
    await reviewRetentionHold({ holdId: HOLD, note: 'Still needed', nextReviewAt: '2026-08-25T00:00:00.000Z' }, actor, NOW);
    expect(repo.insertHoldAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actionType: 'reviewed', previousNextReviewAt: '2026-09-01T00:00:00.000Z', newNextReviewAt: '2026-08-25T00:00:00.000Z',
    }));
  });

  it('appends an extended action when the review date moves later', async () => {
    await reviewRetentionHold({ holdId: HOLD, note: 'Matter ongoing', nextReviewAt: '2026-10-01T00:00:00.000Z' }, actor, NOW);
    expect(repo.insertHoldAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actionType: 'extended' }));
  });

  it('requires the edit action on the hold permission', async () => {
    await reviewRetentionHold({ holdId: HOLD, note: 'ok', nextReviewAt: '2026-10-01T00:00:00.000Z' }, actor, NOW);
    expect(permissions.userHasPermission).toHaveBeenCalledWith(ADMIN, 'fleet.retention-holds', 'edit');
  });

  // The row lock is taken first; a hold released by a concurrent request is
  // reported as a conflict rather than silently re-dated.
  it('conflicts when the hold was released by a concurrent request', async () => {
    repo.lockHold.mockResolvedValue({ ...activeHold, status: 'released', releasedAt: NOW });
    await expect(reviewRetentionHold({ holdId: HOLD, note: 'ok', nextReviewAt: '2026-10-01T00:00:00.000Z' }, actor, NOW))
      .rejects.toBeInstanceOf(RetentionHoldConflictError);
    expect(repo.recordHoldReview).not.toHaveBeenCalled();
  });

  it('404s a hold that does not exist', async () => {
    repo.lockHold.mockResolvedValue(null);
    await expect(reviewRetentionHold({ holdId: HOLD, note: 'ok', nextReviewAt: '2026-10-01T00:00:00.000Z' }, actor, NOW))
      .rejects.toBeInstanceOf(IncidentNotFoundError);
  });

  it('re-checks incident scope for the hold it actually locked', async () => {
    reviewScope.isProjectOwnedByScope.mockResolvedValue(false);
    await expect(reviewRetentionHold({ holdId: HOLD, note: 'ok', nextReviewAt: '2026-10-01T00:00:00.000Z' }, actor, NOW))
      .rejects.toBeInstanceOf(RetentionHoldAccessDeniedError);
    expect(repo.recordHoldReview).not.toHaveBeenCalled();
  });

  // A hold id from one incident's URL must not be actionable through another
  // incident's path, even though scope is checked against the hold's real
  // incident either way.
  it('404s when the path incident does not own the hold', async () => {
    await expect(reviewRetentionHold(
      { holdId: HOLD, incidentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', note: 'ok', nextReviewAt: '2026-10-01T00:00:00.000Z' },
      actor, NOW,
    )).rejects.toBeInstanceOf(IncidentNotFoundError);
    expect(repo.recordHoldReview).not.toHaveBeenCalled();
  });

  it('accepts the matching incident on the path', async () => {
    await expect(reviewRetentionHold(
      { holdId: HOLD, incidentId: INCIDENT, note: 'ok', nextReviewAt: '2026-10-01T00:00:00.000Z' }, actor, NOW,
    )).resolves.toBeTruthy();
  });

  it('rejects a review interval beyond the configured maximum', async () => {
    await expect(reviewRetentionHold({ holdId: HOLD, note: 'ok', nextReviewAt: '2027-01-01T00:00:00.000Z' }, actor, NOW))
      .rejects.toBeInstanceOf(RetentionHoldValidationError);
  });

  it('rejects a blank review note — a review is a decision someone must own', async () => {
    await expect(reviewRetentionHold({ holdId: HOLD, note: '  ', nextReviewAt: '2026-10-01T00:00:00.000Z' }, actor, NOW))
      .rejects.toBeInstanceOf(RetentionHoldValidationError);
  });
});

describe('releaseRetentionHold', () => {
  it('releases and appends the released action', async () => {
    const released = await releaseRetentionHold({ holdId: HOLD, releaseReason: 'Matter closed' }, actor, NOW);
    expect(released.status).toBe('released');
    expect(repo.insertHoldAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actionType: 'released' }));
  });

  it('conflicts on an already released hold instead of releasing twice', async () => {
    repo.lockHold.mockResolvedValue({ ...activeHold, status: 'released' });
    await expect(releaseRetentionHold({ holdId: HOLD, releaseReason: 'again' }, actor, NOW))
      .rejects.toBeInstanceOf(RetentionHoldConflictError);
  });

  it('rejects a blank release reason', async () => {
    await expect(releaseRetentionHold({ holdId: HOLD, releaseReason: ' ' }, actor, NOW))
      .rejects.toBeInstanceOf(RetentionHoldValidationError);
  });

  it('never deletes anything — release is a state change', async () => {
    await releaseRetentionHold({ holdId: HOLD, releaseReason: 'Matter closed' }, actor, NOW);
    expect(repo.recordHoldRelease).toHaveBeenCalled();
    const executed = db.txnQuery.mock.calls.map(([text]) => String(text)).join(' ');
    expect(executed).not.toMatch(/DELETE/i);
  });
});

describe('listIncidentHoldsForViewer', () => {
  it('lets a scoped viewer without hold authority see holds but not manage them', async () => {
    permissions.userHasPermission.mockResolvedValue(false);
    const result = await listIncidentHoldsForViewer(INCIDENT, { userId: 'pm', staffId: null, role: 'project_manager' });
    expect(result.holds).toHaveLength(1);
    expect(result.canManage).toBe(false);
  });

  it('reports manage authority for a hold manager', async () => {
    const result = await listIncidentHoldsForViewer(INCIDENT, actor);
    expect(result.canManage).toBe(true);
  });

  // A released hold stays visible until the incident itself is purged.
  it('includes released holds', async () => {
    repo.listIncidentHolds.mockResolvedValue([{ ...activeHold, status: 'released', releasedAt: NOW }]);
    const result = await listIncidentHoldsForViewer(INCIDENT, actor);
    expect(result.holds[0]!.status).toBe('released');
  });

  it('refuses a viewer outside incident scope', async () => {
    reviewScope.isProjectOwnedByScope.mockResolvedValue(false);
    await expect(listIncidentHoldsForViewer(INCIDENT, actor)).rejects.toBeInstanceOf(RetentionHoldAccessDeniedError);
  });
});
