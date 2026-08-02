import type { TxnClient } from '@/lib/db-pool';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), sql: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ transaction: mocks.transaction, sql: mocks.sql }));

import { applyApprovedAdjustmentTxn, createAndApproveAdjustmentTxn } from '../guardedApproval';

describe('legacy correction approval lock guard', () => {
  it.each([
    ['active weekly lock', true, 'approved'],
    ['orphan locked daily row', false, 'locked'],
  ])('does not mutate evidence or projection for %s', async (_case, activeLock, resultStatus) => {
    const tx = guardedTxn(activeLock as boolean, resultStatus as string);
    mocks.transaction.mockImplementation(async (work) => work(tx));

    await expect(
      applyApprovedAdjustmentTxn({
        adjustmentId: 'adjustment-1',
        reviewerId: 'reviewer-1',
        reviewNote: null,
        entryId: 'entry-1',
        entryUpdatedAt: '2026-08-03T15:00:00Z',
        staffId: '00000000-0000-4000-8000-000000000001',
        workDate: '2026-08-03',
        adjustedClockInAt: null,
        adjustedClockOutAt: new Date('2026-08-03T15:00:00Z'),
        adjustedSiteGeofenceId: null,
      })
    ).rejects.toMatchObject({ code: 'period_locked' });

    const sql = tx.calls.map((call) => call.text).join('\n');
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).not.toMatch(
      /UPDATE attendance_adjustments|UPDATE attendance_entries|DELETE FROM attendance_daily_summaries/i
    );
  });

  it('rolls back approval when the raw-evidence optimistic read loses its race', async () => {
    const tx = guardedTxn(false, 'approved', false);
    let rolledBack = false;
    mocks.transaction.mockImplementation(async (work) => {
      try {
        return await work(tx);
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    });

    const result = await applyApprovedAdjustmentTxn({
      adjustmentId: 'adjustment-1',
      reviewerId: 'reviewer-1',
      reviewNote: null,
      entryId: 'entry-1',
      entryUpdatedAt: '2026-08-03T15:00:00Z',
      staffId: '00000000-0000-4000-8000-000000000001',
      workDate: '2026-08-03',
      adjustedClockInAt: null,
      adjustedClockOutAt: new Date('2026-08-03T15:00:00Z'),
      adjustedSiteGeofenceId: null,
    });

    expect(result).toEqual({ ok: 'conflict', reason: 'entry_changed' });
    expect(rolledBack).toBe(true);
    expect(tx.calls.map((call) => call.text).join('\n')).not.toMatch(/DELETE FROM attendance_daily_summaries/i);
  });

  it.each([
    ['active weekly lock', true, 'approved'],
    ['orphan locked daily row', false, 'locked'],
  ])('does not insert a field adjustment for %s', async (_case, activeLock, resultStatus) => {
    const tx = guardedTxn(activeLock as boolean, resultStatus as string);
    mocks.transaction.mockImplementation(async (work) => work(tx));

    await expect(createAndApproveAdjustmentTxn(createArgs())).rejects.toMatchObject({
      code: 'period_locked',
    });

    expect(tx.calls.map((call) => call.text).join('\n')).not.toMatch(
      /INSERT INTO attendance_adjustments/i
    );
    expect(tx.state.adjustmentExists).toBe(false);
  });

  it('guards before field insert and rolls the insert back on an entry race', async () => {
    const tx = guardedTxn(false, 'approved', false);
    const before = { ...tx.state };
    let rolledBack = false;
    mocks.transaction.mockImplementation(async (work) => {
      try {
        return await work(tx);
      } catch (error) {
        Object.assign(tx.state, before);
        rolledBack = true;
        throw error;
      }
    });

    const result = await createAndApproveAdjustmentTxn(createArgs());
    const sql = tx.calls.map((call) => call.text);

    expect(result).toEqual({ ok: 'conflict', reason: 'entry_changed' });
    const insert = tx.calls.find((call) => /INSERT INTO attendance_adjustments/i.test(call.text));
    const decision = tx.calls.find((call) => /UPDATE attendance_adjustments/i.test(call.text));
    expect(insert?.params[1]).toBe('staff-requester-1');
    expect(decision?.params[0]).toBe('user-reviewer-1');
    expect(sql.findIndex((text) => /pg_advisory_xact_lock/i.test(text))).toBeLessThan(
      sql.findIndex((text) => /INSERT INTO attendance_adjustments/i.test(text))
    );
    expect(rolledBack).toBe(true);
    expect(tx.state).toEqual(before);
  });

  it('preserves raw entry and GPS evidence while invalidating only the derived projection', async () => {
    const tx = guardedTxn(false, 'approved');
    mocks.transaction.mockImplementation(async (work) => work(tx));

    await expect(applyApprovedAdjustmentTxn({
      adjustmentId: 'adjustment-1', reviewerId: 'reviewer-1', reviewNote: null,
      entryId: 'entry-1', entryUpdatedAt: '2026-08-03T15:00:00Z',
      staffId: '00000000-0000-4000-8000-000000000001', workDate: '2026-08-03',
      adjustedClockInAt: null, adjustedClockOutAt: new Date('2026-08-03T15:00:00Z'),
      adjustedSiteGeofenceId: null,
    })).resolves.toMatchObject({ ok: true });

    const statements = tx.calls.map((call) => call.text).join('\n');
    expect(statements).not.toMatch(/UPDATE\s+attendance_entries/i);
    expect(statements).not.toMatch(/DELETE\s+FROM\s+attendance_gps_verifications/i);
    expect(statements).toMatch(/UPDATE\s+attendance_daily_summaries[\s\S]+result_status = 'provisional'/i);
  });
});

function createArgs() {
  return {
    entryId: 'entry-1',
    entryUpdatedAt: '2026-08-03T15:00:00Z',
    staffId: '00000000-0000-4000-8000-000000000001',
    workDate: '2026-08-03',
    requestedBy: 'staff-requester-1',
    reviewerId: 'user-reviewer-1',
    adjustmentKind: 'wrong_clock_out_time' as const,
    reason: 'Correct the recorded clock out',
    reviewNote: 'Admin direct adjust',
    adjustedClockInAt: null,
    adjustedClockOutAt: new Date('2026-08-03T15:00:00Z'),
    adjustedSiteGeofenceId: null,
  };
}

interface Call {
  text: string;
  params: unknown[];
}
interface TxState {
  adjustmentExists: boolean;
  approved: boolean;
}
function guardedTxn(
  activeLock: boolean,
  resultStatus: string,
  entryApplied = true
): TxnClient & { calls: Call[]; state: TxState } {
  const calls: Call[] = [];
  const state: TxState = { adjustmentExists: false, approved: false };
  return {
    calls,
    state,
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (/pg_advisory_xact_lock/i.test(text)) return [{ acquired: '' }];
      if (/INSERT INTO attendance_adjustments/i.test(text)) {
        state.adjustmentExists = true;
        return [{ id: 'adjustment-1', status: 'pending' }];
      }
      if (/UPDATE attendance_adjustments/i.test(text)) {
        state.approved = true;
        return [{ id: 'adjustment-1', status: 'approved' }];
      }
      if (/SELECT id FROM attendance_entries[\s\S]+updated_at/i.test(text)) {
        return entryApplied ? [{ id: 'entry-1' }] : [];
      }
      if (/SELECT id FROM attendance_entries/i.test(text)) return [{ id: 'entry-1' }];
      return [];
    }),
    queryOne: vi.fn(async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (/attendance_weekly_locks/i.test(text)) return { active_period_lock: activeLock };
      if (/SELECT result_status/i.test(text)) return { result_status: resultStatus };
      return null;
    }),
    client: {} as TxnClient['client'],
  };
}
