import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreparedCandidate } from '../types';

const mocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => ({
  queryOne: mocks.queryOne,
  transaction: mocks.transaction,
}));

import {
  claimDueAcknowledgementCleanup,
  claimNextExport,
  createExport,
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

  it('returns the existing canonical export for the same DR and phone', async () => {
    const canonical = exportRow({ state: 'completed' });
    const tx = {
      query: vi.fn().mockResolvedValue([{ export_id: 'export-1' }]),
      queryOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(canonical),
    };
    mocks.transaction.mockImplementation(async (work) => work(tx));

    await expect(createExport(run, candidate())).resolves.toMatchObject({
      created: false,
      export: { id: 'export-1', state: 'completed' },
    });
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
    const claimed = exportRow({ state: 'ack_cleanup_pending', attempt_count: 2, next_attempt_at: null });
    const tx = { query: vi.fn(), queryOne: vi.fn().mockResolvedValueOnce(due).mockResolvedValueOnce(claimed) };
    mocks.transaction.mockImplementation(async (work) => work(tx));
    const now = new Date('2026-08-02T09:00:00Z');

    await expect(claimDueAcknowledgementCleanup(now, ['export-1'])).resolves.toMatchObject({
      id: 'export-1', state: 'ack_cleanup_pending', attemptCount: 2, nextAttemptAt: null,
    });

    const [selectText, selectParams] = tx.queryOne.mock.calls[0] as [string, unknown[]];
    const [updateText, updateParams] = tx.queryOne.mock.calls[1] as [string, unknown[]];
    expect(selectText).toContain("e.state = 'ack_cleanup_pending'");
    expect(selectText).toContain('e.next_attempt_at <= $1');
    expect(selectText).toContain('e.id = ANY($2::uuid[])');
    expect(selectParams).toEqual([now, ['export-1']]);
    expect(updateText).toContain('attempt_count = attempt_count + 1');
    expect(updateText).toContain("state = 'ack_cleanup_pending'");
    expect(updateParams).toEqual(['export-1', ['export-1'], now]);
  });
});
