import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ transaction: vi.fn(), txnQuery: vi.fn(), txnQueryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ transaction: db.transaction }));

const settings = vi.hoisted(() => ({ getEffectiveAnalyticsRetentionSettings: vi.fn() }));
vi.mock('../../analytics/settingsRepository', () => settings);

const repo = vi.hoisted(() => ({
  listPurgeCandidates: vi.fn(), countCandidatesHeld: vi.fn(), listIncidentStorageObjects: vi.fn(),
  hasCompleteAggregateCoverage: vi.fn(), insertRetentionRun: vi.fn(), finalizeRetentionRun: vi.fn(),
  getIncidentPurgeState: vi.fn(),
  claimIncident: vi.fn(), recordStorageObjectDeleted: vi.fn(), markStorageComplete: vi.fn(),
  markItemFailed: vi.fn(), recordItemAttempt: vi.fn(), listResumableItems: vi.fn(), getItem: vi.fn(),
}));
vi.mock('../retentionRepository', () => repo);

const purge = vi.hoisted(() => ({ purgeIncidentRecords: vi.fn() }));
vi.mock('../incidentPurge', () => purge);

const storage = vi.hoisted(() => ({ deleteIncidentStorageObject: vi.fn() }));
vi.mock('../storageDeletion', () => storage);

const notifications = vi.hoisted(() => ({ notifyRetentionHealth: vi.fn() }));
vi.mock('../retentionNotifications', () => notifications);

import { LiveRetentionDisabledError, runOperationalRetention } from '../retentionService';

const INCIDENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INCIDENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RUN = 'rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrrr';
// 2026-08-21T09:00 SAST. Twelve months back puts the cutoff at 2025-08-21.
const NOW = '2026-08-21T07:00:00.000Z';

const policy = {
  version: 1, effectiveFrom: '2026-08-01T00:00:00.000Z', retentionMonths: 12, anonymityMinContributors: 5,
  recalculationWindowMonths: 3, retentionBatchSize: 100, maximumHoldReviewDays: 90,
  holdReviewReminderLeadDays: 14, aggregationRunHourSast: 1, aggregationRunMinuteSast: 0,
  retentionRunHourSast: 3, retentionRunMinuteSast: 30, aggregateFreshnessWarningHours: 36,
  retentionFreshnessWarningHours: 48, permittedHoldCategories: ['legal'], metricVersion: 1,
  liveRetentionEnabled: true,
};

const candidateA = { incidentId: INCIDENT_A, workDate: '2025-01-15', monthStart: '2025-01-01' };
const candidateB = { incidentId: INCIDENT_B, workDate: '2025-02-15', monthStart: '2025-02-01' };
const itemA = { id: 'item-a', retentionRunId: RUN, incidentId: INCIDENT_A, stage: 'pending_storage', storageObjectsTotal: 1, storageObjectsDeleted: 0, attempts: 1, lastErrorCode: null };
const itemB = { ...itemA, id: 'item-b', incidentId: INCIDENT_B };

function happyPath(): void {
  settings.getEffectiveAnalyticsRetentionSettings.mockResolvedValue(policy);
  repo.listPurgeCandidates.mockResolvedValue([candidateA]);
  repo.countCandidatesHeld.mockResolvedValue(0);
  repo.listIncidentStorageObjects.mockResolvedValue([{ evidenceId: 'ev-1', storagePath: 'fleet/incidents/a.jpg' }]);
  repo.hasCompleteAggregateCoverage.mockResolvedValue(true);
  repo.insertRetentionRun.mockResolvedValue(RUN);
  repo.getIncidentPurgeState.mockResolvedValue('purgeable');
  // Explicit defaults: vi.clearAllMocks() clears CALLS but not
  // implementations, so a mockRejectedValue set by one test would otherwise
  // leak into every test after it.
  repo.markItemFailed.mockResolvedValue(undefined);
  repo.markStorageComplete.mockResolvedValue(undefined);
  repo.recordStorageObjectDeleted.mockResolvedValue(undefined);
  repo.recordItemAttempt.mockResolvedValue(undefined);
  repo.finalizeRetentionRun.mockResolvedValue(undefined);
  repo.listResumableItems.mockResolvedValue([]);
  repo.claimIncident.mockImplementation(async (_txn: unknown, params: { incidentId: string }) =>
    (params.incidentId === INCIDENT_A ? itemA : itemB));
  db.transaction.mockImplementation(async (work: (txn: unknown) => Promise<unknown>) => work({ query: db.txnQuery, queryOne: db.txnQueryOne }));
  storage.deleteIncidentStorageObject.mockResolvedValue('deleted');
  purge.purgeIncidentRecords.mockResolvedValue(undefined);
  notifications.notifyRetentionHealth.mockResolvedValue({ notificationsSent: 0, notificationsFailed: 0, recipientsMissing: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  happyPath();
});

describe('dry run', () => {
  it('reports what would be deleted and mutates nothing', async () => {
    repo.listPurgeCandidates.mockResolvedValue([candidateA, candidateB]);
    repo.countCandidatesHeld.mockResolvedValue(2);
    const result = await runOperationalRetention({ dryRun: true, requestedAt: NOW });

    expect(result).toMatchObject({
      dryRun: true, status: 'succeeded', itemsConsidered: 2, itemsClaimed: 0, itemsCompleted: 0,
      itemsSkippedHold: 2, storageObjectsDeleted: 0,
    });
    expect(repo.claimIncident).not.toHaveBeenCalled();
    expect(storage.deleteIncidentStorageObject).not.toHaveBeenCalled();
    expect(purge.purgeIncidentRecords).not.toHaveBeenCalled();
  });

  it('records the run as a dry run so the schema can enforce that it deleted nothing', async () => {
    await runOperationalRetention({ dryRun: true, requestedAt: NOW });
    expect(repo.insertRetentionRun).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, policyMonths: 12 }));
    expect(repo.finalizeRetentionRun).toHaveBeenCalledWith(RUN, expect.objectContaining({ itemsClaimed: 0, itemsCompleted: 0, storageObjectsDeleted: 0 }));
  });

  it('counts the storage objects that would be deleted without touching storage', async () => {
    repo.listIncidentStorageObjects.mockResolvedValue([
      { evidenceId: 'ev-1', storagePath: 'fleet/incidents/a.jpg' },
      { evidenceId: 'ev-2', storagePath: 'fleet/incidents/b.jpg' },
    ]);
    const result = await runOperationalRetention({ dryRun: true, requestedAt: NOW });
    expect(result.storageObjectsPending).toBe(2);
    expect(storage.deleteIncidentStorageObject).not.toHaveBeenCalled();
  });

  it('uses the SAST work-date cutoff derived from the effective policy', async () => {
    await runOperationalRetention({ dryRun: true, requestedAt: NOW });
    expect(repo.listPurgeCandidates).toHaveBeenCalledWith({ cutoffWorkDate: '2025-08-21', limit: 100 });
  });

  it('reports coverage-blocked candidates separately and does not count them as deletable', async () => {
    repo.hasCompleteAggregateCoverage.mockResolvedValue(false);
    const result = await runOperationalRetention({ dryRun: true, requestedAt: NOW });
    expect(result.itemsSkippedCoverage).toBe(1);
    expect(result.storageObjectsPending).toBe(0);
  });
});

describe('live run', () => {
  it('refuses to run live while live retention is disabled in settings', async () => {
    settings.getEffectiveAnalyticsRetentionSettings.mockResolvedValue({ ...policy, liveRetentionEnabled: false });
    await expect(runOperationalRetention({ dryRun: false, requestedAt: NOW })).rejects.toBeInstanceOf(LiveRetentionDisabledError);
    expect(repo.insertRetentionRun).not.toHaveBeenCalled();
    expect(purge.purgeIncidentRecords).not.toHaveBeenCalled();
  });

  it('deletes storage first, then the database records, and completes the item', async () => {
    const result = await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(storage.deleteIncidentStorageObject).toHaveBeenCalledWith('fleet/incidents/a.jpg');
    expect(repo.markStorageComplete).toHaveBeenCalledWith('item-a');
    expect(purge.purgeIncidentRecords).toHaveBeenCalledWith({ itemId: 'item-a', incidentId: INCIDENT_A });
    expect(result).toMatchObject({ status: 'succeeded', itemsClaimed: 1, itemsCompleted: 1, storageObjectsDeleted: 1 });
  });

  // The whole point of the coverage gate: detail may only disappear once the
  // anonymous trend that replaces it exists.
  it('never claims an incident whose month has no aggregate coverage', async () => {
    repo.hasCompleteAggregateCoverage.mockResolvedValue(false);
    const result = await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(repo.claimIncident).not.toHaveBeenCalled();
    expect(purge.purgeIncidentRecords).not.toHaveBeenCalled();
    expect(result.itemsSkippedCoverage).toBe(1);
  });

  // Failure-safe: the database evidence stays for the retry.
  it('keeps the database records when storage deletion fails', async () => {
    storage.deleteIncidentStorageObject.mockRejectedValue(new Error('VF Storage delete failed: HTTP 500'));
    const result = await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(purge.purgeIncidentRecords).not.toHaveBeenCalled();
    expect(repo.markItemFailed).toHaveBeenCalledWith('item-a', expect.any(String));
    expect(result).toMatchObject({ status: 'partial', itemsFailed: 1, itemsCompleted: 0 });
  });

  it('treats an object that is already gone as deleted so a retry can finish', async () => {
    storage.deleteIncidentStorageObject.mockResolvedValue('already_absent');
    const result = await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(purge.purgeIncidentRecords).toHaveBeenCalled();
    expect(result.itemsCompleted).toBe(1);
  });

  it('marks the item failed but keeps it resumable when the database purge fails', async () => {
    purge.purgeIncidentRecords.mockRejectedValue(new Error('deadlock detected'));
    const result = await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(repo.markItemFailed).toHaveBeenCalledWith('item-a', expect.any(String));
    expect(result).toMatchObject({ status: 'partial', itemsFailed: 1 });
  });

  it('isolates one failing item from the rest of the batch', async () => {
    repo.listPurgeCandidates.mockResolvedValue([candidateA, candidateB]);
    storage.deleteIncidentStorageObject.mockRejectedValueOnce(new Error('HTTP 500'));
    const result = await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(result).toMatchObject({ itemsCompleted: 1, itemsFailed: 1, status: 'partial' });
    expect(purge.purgeIncidentRecords).toHaveBeenCalledWith({ itemId: 'item-b', incidentId: INCIDENT_B });
  });

  it('resumes an item left behind by an earlier run before claiming new work', async () => {
    repo.listResumableItems.mockResolvedValue([{ ...itemA, id: 'stale-1', stage: 'failed', attempts: 2 }]);
    await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(repo.recordItemAttempt).toHaveBeenCalledWith('stale-1');
    expect(purge.purgeIncidentRecords).toHaveBeenCalledWith({ itemId: 'stale-1', incidentId: INCIDENT_A });
  });

  it('skips the storage stage for an item that already finished it', async () => {
    repo.listResumableItems.mockResolvedValue([{ ...itemA, id: 'stale-2', stage: 'storage_complete', storageObjectsDeleted: 1 }]);
    repo.listPurgeCandidates.mockResolvedValue([]);
    await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(storage.deleteIncidentStorageObject).not.toHaveBeenCalled();
    expect(purge.purgeIncidentRecords).toHaveBeenCalledWith({ itemId: 'stale-2', incidentId: INCIDENT_A });
  });

  it('reports a claim refused by the hold guard as skipped, not as a crash', async () => {
    repo.claimIncident.mockRejectedValue(Object.assign(new Error('active hold'), { code: '23514' }));
    const result = await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(result).toMatchObject({ itemsSkippedHold: 1, itemsClaimed: 0 });
    expect(purge.purgeIncidentRecords).not.toHaveBeenCalled();
  });

  it('bounds the batch by the configured size', async () => {
    settings.getEffectiveAnalyticsRetentionSettings.mockResolvedValue({ ...policy, retentionBatchSize: 25 });
    await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(repo.listPurgeCandidates).toHaveBeenCalledWith({ cutoffWorkDate: '2025-08-21', limit: 25 });
  });
});

describe('a hold landing between the claim and the storage deletion', () => {
  // The window the schema cannot close: the claim has COMMITTED and storage
  // deletion happens over HTTP, outside any transaction. Discovering the hold
  // by having the first bookkeeping UPDATE refused means an attachment has
  // already been destroyed for an incident somebody just decided to keep.
  it('re-checks purgeability before deleting the first object', async () => {
    await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    const checkOrder = repo.getIncidentPurgeState.mock.invocationCallOrder[0]!;
    const deleteOrder = storage.deleteIncidentStorageObject.mock.invocationCallOrder[0]!;
    expect(checkOrder).toBeLessThan(deleteOrder);
  });

  it('destroys nothing when the incident is held by the time storage would run', async () => {
    repo.getIncidentPurgeState.mockResolvedValue('held');
    const result = await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(storage.deleteIncidentStorageObject).not.toHaveBeenCalled();
    expect(purge.purgeIncidentRecords).not.toHaveBeenCalled();
    expect(result.itemsSkippedHold).toBe(1);
  });

  // Every UPDATE to a still-identified item is refused by the schema trigger
  // once a hold exists — including markItemFailed. Touching the row at all
  // turns a clean skip into an exception that aborts the run.
  it('does not touch the item row at all when the guard would refuse it', async () => {
    repo.getIncidentPurgeState.mockResolvedValue('held');
    await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(repo.markItemFailed).not.toHaveBeenCalled();
    expect(repo.recordStorageObjectDeleted).not.toHaveBeenCalled();
    expect(repo.markStorageComplete).not.toHaveBeenCalled();
  });

  it('keeps processing the rest of the batch when one item is held', async () => {
    repo.listPurgeCandidates.mockResolvedValue([candidateA, candidateB]);
    repo.getIncidentPurgeState.mockImplementation(async (incidentId: string) =>
      (incidentId === INCIDENT_A ? 'held' : 'purgeable'));
    const result = await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(purge.purgeIncidentRecords).toHaveBeenCalledWith({ itemId: 'item-b', incidentId: INCIDENT_B });
    expect(result).toMatchObject({ itemsSkippedHold: 1, itemsCompleted: 1, status: 'succeeded' });
  });

  // A hold landing INSIDE the window, after the re-check: the guard refusal
  // surfaces as 23514 from a bookkeeping write. It is an expected outcome, not
  // a crash, and the failure path must not try to record it — that write is
  // refused too.
  it('treats a guard refusal raised mid-item as a skip, not a failure', async () => {
    repo.recordStorageObjectDeleted.mockRejectedValue(Object.assign(new Error('purge guard'), { code: '23514' }));
    const result = await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(repo.markItemFailed).not.toHaveBeenCalled();
    expect(result).toMatchObject({ itemsSkippedHold: 1, itemsFailed: 0, status: 'succeeded' });
  });

  it('never lets a refused bookkeeping write abort the whole run', async () => {
    repo.listPurgeCandidates.mockResolvedValue([candidateA, candidateB]);
    repo.markStorageComplete.mockRejectedValueOnce(Object.assign(new Error('purge guard'), { code: '23514' }));
    const result = await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(result.itemsCompleted).toBe(1);
    expect(purge.purgeIncidentRecords).toHaveBeenCalledWith({ itemId: 'item-b', incidentId: INCIDENT_B });
  });

  // Belt and braces: even a NON-guard failure to record a failure must not
  // take the run down. Bookkeeping is never more important than the batch.
  it('survives a failure-recording write that fails for any other reason', async () => {
    purge.purgeIncidentRecords.mockRejectedValue(new Error('deadlock'));
    repo.markItemFailed.mockRejectedValue(new Error('db down'));
    const result = await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(result).toMatchObject({ status: 'partial', itemsFailed: 1 });
  });

  // Objects a previous attempt already deleted come back "already absent".
  // Counting those would report deletions this run never performed, and the
  // run totals are what an operator reads to decide the pipeline is behaving.
  it('counts only objects it actually deleted, never ones already gone', async () => {
    repo.listResumableItems.mockResolvedValue([
      { ...itemA, id: 'stale-3', stage: 'failed', storageObjectsTotal: 2, storageObjectsDeleted: 1 },
    ]);
    repo.listPurgeCandidates.mockResolvedValue([]);
    repo.listIncidentStorageObjects.mockResolvedValue([
      { evidenceId: 'ev-1', storagePath: 'fleet/incidents/a.jpg' },
      { evidenceId: 'ev-2', storagePath: 'fleet/incidents/b.jpg' },
    ]);
    storage.deleteIncidentStorageObject.mockResolvedValue('already_absent');
    const result = await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(storage.deleteIncidentStorageObject).toHaveBeenCalledTimes(2);
    expect(result.storageObjectsDeleted).toBe(0);
    expect(result.itemsCompleted).toBe(1);
  });

  // A resumed item that had already finished storage must not re-run it: the
  // stage is overwritten by markItemFailed, so the durable counters decide.
  it('does not re-run storage for an item whose objects are all accounted for', async () => {
    repo.listResumableItems.mockResolvedValue([
      { ...itemA, id: 'stale-4', stage: 'failed', storageObjectsTotal: 1, storageObjectsDeleted: 1 },
    ]);
    repo.listPurgeCandidates.mockResolvedValue([]);
    await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(storage.deleteIncidentStorageObject).not.toHaveBeenCalled();
    expect(purge.purgeIncidentRecords).toHaveBeenCalledWith({ itemId: 'stale-4', incidentId: INCIDENT_A });
  });

  it('skips a resumable item that is now held without recording an attempt', async () => {
    repo.listResumableItems.mockResolvedValue([{ ...itemA, id: 'stale-1', stage: 'failed', attempts: 2 }]);
    repo.listPurgeCandidates.mockResolvedValue([]);
    repo.getIncidentPurgeState.mockResolvedValue('held');
    const result = await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(repo.recordItemAttempt).not.toHaveBeenCalled();
    expect(storage.deleteIncidentStorageObject).not.toHaveBeenCalled();
    expect(result.itemsSkippedHold).toBe(1);
  });

  // One held resumable item used to abort every run before any candidate was
  // reached, wedging the pipeline until the hold was released.
  it('still processes new candidates when a resumable item is held', async () => {
    repo.listResumableItems.mockResolvedValue([{ ...itemA, id: 'stale-1', incidentId: INCIDENT_B, stage: 'failed' }]);
    repo.getIncidentPurgeState.mockImplementation(async (incidentId: string) =>
      (incidentId === INCIDENT_B ? 'held' : 'purgeable'));
    const result = await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(purge.purgeIncidentRecords).toHaveBeenCalledWith({ itemId: 'item-a', incidentId: INCIDENT_A });
    expect(result.itemsCompleted).toBe(1);
  });
});

describe('run finalisation', () => {
  it('evaluates retention health after the run, never during it', async () => {
    await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(notifications.notifyRetentionHealth).toHaveBeenCalledWith({ at: NOW });
    const finalizeOrder = repo.finalizeRetentionRun.mock.invocationCallOrder[0]!;
    const notifyOrder = notifications.notifyRetentionHealth.mock.invocationCallOrder[0]!;
    expect(notifyOrder).toBeGreaterThan(finalizeOrder);
  });

  it('does not fail the run because a notification failed', async () => {
    notifications.notifyRetentionHealth.mockRejectedValue(new Error('bus down'));
    const result = await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(result.status).toBe('succeeded');
  });

  it('records a fatal failure on the run rather than losing it', async () => {
    repo.listPurgeCandidates.mockRejectedValue(new Error('db down'));
    await expect(runOperationalRetention({ dryRun: false, requestedAt: NOW })).rejects.toThrow(/db down/);
    expect(repo.finalizeRetentionRun).toHaveBeenCalledWith(RUN, expect.objectContaining({ status: 'failed' }));
  });

  // A run that failed halfway must never read as a success.
  it('never reports partial work as succeeded', async () => {
    repo.listPurgeCandidates.mockResolvedValue([candidateA, candidateB]);
    purge.purgeIncidentRecords.mockRejectedValueOnce(new Error('deadlock'));
    const result = await runOperationalRetention({ dryRun: false, requestedAt: NOW });
    expect(result.status).toBe('partial');
    expect(repo.finalizeRetentionRun).toHaveBeenCalledWith(RUN, expect.objectContaining({ status: 'partial' }));
  });
});
