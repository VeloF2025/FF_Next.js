import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreparedCandidate } from '../types';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
  transaction: mocks.transaction,
}));

import {
  claimDueAcknowledgementCleanup,
  claimNextExport,
  createExport,
  expireStalledHandshakes,
  saveCandidateDecision,
  transitionExportState,
} from '../exportRepository';
import type { VelocityReviewRun } from '../runRepository';

const run: VelocityReviewRun = {
  id: 'run-1',
  targetDate: '2026-08-01',
  status: 'running',
  startedAt: null,
  completedAt: null,
  counts: {},
  summaryStatus: 'pending',
};

function candidate(overrides: Partial<PreparedCandidate> = {}): PreparedCandidate {
  return {
    drNumber: 'DR-100',
    sources: ['dr_submitted'],
    msisdn: '27821234567',
    phoneE164: '+27821234567',
    phoneFingerprint: 'a'.repeat(64),
    phoneSource: 'onemap',
    firstName: 'Ada',
    lastName: 'Lovelace',
    consentEvidence: {
      source: 'onemap_home_signup',
      grantedAt: new Date('2026-07-31T08:00:00Z'),
    },
    ...overrides,
  };
}

function exportRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'export-1',
    first_run_id: run.id,
    first_target_date: run.targetDate,
    dr_number: 'DR-100',
    phone_e164: '+27821234567',
    phone_fingerprint: 'a'.repeat(64),
    phone_source: 'onemap',
    source_flags: ['dr_submitted'],
    export_key: 'key-1',
    ghl_contact_id: null,
    state: 'ready',
    attempt_count: 0,
    next_attempt_at: null,
    error_code: null,
    upserted_at: null,
    trigger_requested_at: null,
    workflow_acknowledged_at: null,
    completed_at: null,
    created_at: new Date('2026-08-02T07:00:00Z'),
    updated_at: new Date('2026-08-02T07:00:00Z'),
    ...overrides,
  };
}

describe('Velocity review export persistence', () => {
  beforeEach(() => {
    mocks.queryOne.mockReset();
    mocks.transaction.mockReset().mockImplementation(async (work) => work({
      query: vi.fn(),
      queryOne: vi.fn(),
    }));
  });

  it('persists every candidate decision by target date and DR', async () => {
    mocks.queryOne.mockResolvedValue({ id: 'candidate-1' });

    await saveCandidateDecision(run, { status: 'ready', candidate: candidate() });

    const [text, params] = mocks.queryOne.mock.calls[0] as [string, unknown[]];
    expect(text).toContain('ON CONFLICT (target_date, dr_number) DO UPDATE');
    expect(params).toContain(run.targetDate);
    expect(params).toContain('DR-100');
  });

  it('returns the existing canonical export for the same DR and phone across fingerprint rotation', async () => {
    const canonical = exportRow({ state: 'completed' });
    const tx = {
      query: vi.fn().mockResolvedValue([{ export_id: 'export-1' }]),
      queryOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(canonical),
    };
    mocks.transaction.mockImplementation(async (work) => work(tx));

    await expect(createExport(run, candidate({ phoneFingerprint: 'b'.repeat(64) }))).resolves.toMatchObject({
      created: false,
      export: { id: 'export-1', state: 'completed' },
    });
    const [insertSql] = tx.queryOne.mock.calls[0] as [string, unknown[]];
    const [selectSql, selectParams] = tx.queryOne.mock.calls[1] as [string, unknown[]];
    expect(insertSql).toContain('ON CONFLICT (dr_number, phone_e164) DO NOTHING');
    expect(selectSql).toContain('WHERE dr_number = $1 AND phone_e164 = $2');
    expect(selectParams).toEqual(['DR-100', '+27821234567']);
  });

  it('creates a separate ready export for a different DR on the same phone', async () => {
    const second = exportRow({ id: 'export-2', dr_number: 'DR-200' });
    const tx = {
      query: vi.fn().mockResolvedValue([{ export_id: 'export-2' }]),
      queryOne: vi.fn().mockResolvedValueOnce(second),
    };
    mocks.transaction.mockImplementation(async (work) => work(tx));

    await expect(createExport(run, candidate({ drNumber: 'DR-200' }))).resolves.toMatchObject({
      created: true,
      export: { id: 'export-2', drNumber: 'DR-200', state: 'ready' },
    });
  });

  it('redacts transaction errors that contain the candidate phone', async () => {
    const input = candidate();
    mocks.transaction.mockRejectedValue(
      new Error(`failing row contains ${input.phoneE164}`),
    );

    let caught: unknown;
    try {
      await createExport(run, input);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      name: 'VelocityReviewRepositoryError',
      code: 'velocity_review_export_persistence_failed',
      message: 'Velocity review export persistence failed',
    });
    const exposed = caught instanceof Error
      ? `${caught.message}\n${caught.stack ?? ''}\n${String(caught.cause ?? '')}`
      : String(caught);
    expect(exposed).not.toContain(input.phoneE164);
  });

  it('rejects a stale expected state with a conditional transition', async () => {
    mocks.queryOne.mockResolvedValue(null);

    await expect(transitionExportState(
      'export-1',
      'ready',
      'upserting',
    )).resolves.toBeNull();

    const [text, params] = mocks.queryOne.mock.calls[0] as [string, unknown[]];
    expect(text).toContain('WHERE id = $1 AND state = $2');
    expect(params).toEqual(['export-1', 'ready', 'upserting']);
  });

  it('claims through SKIP LOCKED and conditionally increments attempts', async () => {
    const ready = exportRow();
    const claimed = exportRow({ state: 'upserting', attempt_count: 1 });
    const tx = {
      query: vi.fn(),
      queryOne: vi.fn()
        .mockResolvedValueOnce(ready)
        .mockResolvedValueOnce(claimed),
    };
    mocks.transaction.mockImplementation(async (work) => work(tx));

    const now = new Date('2026-08-02T09:00:00Z');
    await expect(claimNextExport(now, ['export-1'])).resolves.toMatchObject({
      id: 'export-1',
      state: 'upserting',
      attemptCount: 1,
    });

    const [selectText, selectParams] = tx.queryOne.mock.calls[0] as [string, unknown[]];
    const [updateText, updateParams] = tx.queryOne.mock.calls[1] as [string, unknown[]];
    expect(selectText).toContain('FOR UPDATE SKIP LOCKED');
    expect(selectText).toContain("state IN ('ready', 'retryable_failure')");
    expect(selectText).toContain('e.id = ANY($2::uuid[])');
    expect(selectParams).toEqual([now, ['export-1']]);
    expect(updateText).toContain('WHERE id = $1 AND state = $2');
    expect(updateText).toContain('id = ANY($3::uuid[])');
    expect(updateParams).toEqual(['export-1', 'ready', ['export-1']]);
  });

  it('claims only due scoped acknowledgement cleanup and increments its attempt', async () => {
    const due = exportRow({ state: 'ack_cleanup_pending', attempt_count: 1,
      next_attempt_at: new Date('2026-08-02T08:59:00Z') });
    const leaseUntil = new Date('2026-08-02T09:01:00Z');
    const claimed = exportRow({ state: 'ack_cleanup_pending', attempt_count: 2, next_attempt_at: leaseUntil });
    const tx = { query: vi.fn(), queryOne: vi.fn().mockResolvedValueOnce(due).mockResolvedValueOnce(claimed) };
    mocks.transaction.mockImplementation(async (work) => work(tx));
    const now = new Date('2026-08-02T09:00:00Z');

    await expect(claimDueAcknowledgementCleanup(now, ['export-1'], leaseUntil)).resolves.toMatchObject({
      id: 'export-1', state: 'ack_cleanup_pending', attemptCount: 2, nextAttemptAt: leaseUntil,
    });

    const [selectText, selectParams] = tx.queryOne.mock.calls[0] as [string, unknown[]];
    const [updateText, updateParams] = tx.queryOne.mock.calls[1] as [string, unknown[]];
    expect(selectText).toContain("e.state = 'ack_cleanup_pending'");
    expect(selectText).toContain('e.next_attempt_at <= $1');
    expect(selectText).toContain('e.id = ANY($2::uuid[])');
    expect(selectParams).toEqual([now, ['export-1']]);
    expect(updateText).toContain('attempt_count = attempt_count + 1');
    expect(updateText).toContain('next_attempt_at = $4');
    expect(updateText).toContain("state = 'ack_cleanup_pending'");
    expect(updateParams).toEqual(['export-1', ['export-1'], now, leaseUntil]);
  });

  it('does not reclaim an active cleanup lease but reclaims it after expiry', async () => {
    const activeLease = new Date('2026-08-02T09:01:00Z');
    const restartAt = new Date('2026-08-02T09:01:01Z');
    const restartLease = new Date('2026-08-02T09:02:01Z');
    const beforeTx = { query: vi.fn(), queryOne: vi.fn().mockResolvedValue(null) };
    const afterTx = { query: vi.fn(), queryOne: vi.fn()
      .mockResolvedValueOnce(exportRow({ state: 'ack_cleanup_pending', attempt_count: 2,
        next_attempt_at: activeLease }))
      .mockResolvedValueOnce(exportRow({ state: 'ack_cleanup_pending', attempt_count: 3,
        next_attempt_at: restartLease })) };
    mocks.transaction.mockImplementationOnce(async (work) => work(beforeTx))
      .mockImplementationOnce(async (work) => work(afterTx));

    await expect(claimDueAcknowledgementCleanup(
      new Date('2026-08-02T09:00:59Z'), ['export-1'], activeLease,
    )).resolves.toBeNull();
    await expect(claimDueAcknowledgementCleanup(
      restartAt, ['export-1'], restartLease,
    )).resolves.toMatchObject({ attemptCount: 3, nextAttemptAt: restartLease });

    expect(beforeTx.queryOne).toHaveBeenCalledTimes(1);
    expect(afterTx.queryOne).toHaveBeenCalledTimes(2);
    expect(afterTx.queryOne.mock.calls[1]?.[1]).toEqual(['export-1', ['export-1'], restartAt, restartLease]);
  });
});


describe('expireStalledHandshakes', () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it('resolves only ambiguous and ack_cleanup_pending rows older than the cutoff', async () => {
    mocks.query.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const cutoff = new Date('2026-08-19T09:00:00.000Z');

    const now = new Date('2026-08-20T09:00:00.000Z');

    const expired = await expireStalledHandshakes(cutoff, now);

    expect(expired).toBe(2);
    const [sql, params] = mocks.query.mock.calls[0];
    // One injectable clock: the retry-due bound is a parameter, not SQL NOW().
    expect(params).toEqual([cutoff, now]);
    expect(sql).toContain("state IN ('ambiguous', 'ack_cleanup_pending')");
    expect(sql).toContain('updated_at < $1');
    expect(sql).toContain("state = 'permanent_failure'");
  });

  it('leaves a row alone while its own retry is still scheduled', async () => {
    mocks.query.mockResolvedValue([]);

    await expireStalledHandshakes(new Date('2026-08-19T09:00:00.000Z'), new Date());

    // nextRetryAt honours an uncapped GHL Retry-After, so a pending next_attempt_at
    // can outlive the stale window; expiring it would drop a live retry.
    const [sql] = mocks.query.mock.calls[0];
    expect(sql).toContain('next_attempt_at IS NULL OR next_attempt_at <= $2');
  });

  it('does not prefix a bare handshake code with a colon', async () => {
    mocks.query.mockResolvedValue([]);

    await expireStalledHandshakes(new Date(), new Date());

    const [sql] = mocks.query.mock.calls[0];
    expect(sql).toContain("COALESCE(error_code || ':', '') || 'handshake_expired'");
  });

  it('reports zero when nothing is stale', async () => {
    mocks.query.mockResolvedValue([]);
    await expect(expireStalledHandshakes(new Date(), new Date())).resolves.toBe(0);
  });
});
