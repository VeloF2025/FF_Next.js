import type { TxnClient } from '@/lib/db-pool';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db-pool', () => ({ transaction: vi.fn() }));

import { ATTENDANCE_WEEK_LOCK_NAMESPACE } from '@/modules/attendance/corrections/lockQueries';
import { upsertDailyProjectionTxn } from '../projectionRepository';
import type { CalculatedDailyResult } from '../types';

const STAFF_ID = '00000000-0000-0000-0000-000000000001';
const POLICY_ID = '00000000-0000-0000-0000-000000000003';

describe('locked projection immutability', () => {
  it('takes the canonical week guard before reading or mutating the projection', async () => {
    const tx = new GuardTxn(false, null);

    await upsertDailyProjectionTxn(tx, projectionArgs());

    expect(tx.calls[0]).toMatchObject({
      params: [ATTENDANCE_WEEK_LOCK_NAMESPACE, '2026-08-03'],
    });
    expect(tx.calls[0]?.text).toMatch(/pg_advisory_xact_lock/i);
    expect(tx.calls.findIndex((call) => /attendance_weekly_locks/i.test(call.text))).toBeGreaterThan(0);
    expect(tx.calls.findIndex((call) => /SELECT calculation_fingerprint/i.test(call.text))).toBeGreaterThan(0);
  });

  it('rejects an active weekly lock before projection refresh or exception mutation', async () => {
    const tx = new GuardTxn(true, { calculation_fingerprint: 'fingerprint', result_version: 1,
      result_status: 'approved' });

    await expect(upsertDailyProjectionTxn(tx, projectionArgs())).rejects.toMatchObject({
      code: 'period_locked',
    });

    expect(tx.mutations).toEqual([]);
  });

  it('rejects an orphan locked daily row even without an active weekly lock', async () => {
    const tx = new GuardTxn(false, { calculation_fingerprint: 'fingerprint', result_version: 4,
      result_status: 'locked' });

    await expect(upsertDailyProjectionTxn(tx, projectionArgs())).rejects.toMatchObject({
      code: 'period_locked',
    });

    expect(tx.mutations).toEqual([]);
  });
});

interface Call { text: string; params: unknown[] }
class GuardTxn implements TxnClient {
  calls: Call[] = [];
  mutations: string[] = [];
  client = {} as TxnClient['client'];
  constructor(
    private readonly activeLock: boolean,
    private readonly projection: Record<string, unknown> | null,
  ) {}
  async query(text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    this.calls.push({ text, params });
    if (/^(\s*)(UPDATE|INSERT|DELETE)/i.test(text)) this.mutations.push(text);
    if (/pg_advisory_xact_lock/i.test(text)) return [{ acquired: '' }];
    return [];
  }
  async queryOne(text: string, params: unknown[] = []): Promise<Record<string, unknown> | null> {
    this.calls.push({ text, params });
    if (/^(\s*)(UPDATE|INSERT|DELETE)/i.test(text)) this.mutations.push(text);
    if (/attendance_weekly_locks/i.test(text)) return { active_period_lock: this.activeLock };
    if (/SELECT calculation_fingerprint/i.test(text)) return this.projection;
    if (/SELECT overtime_rule_id/i.test(text)) return { overtime_rule_id: POLICY_ID };
    if (/INSERT INTO attendance_daily_summaries/i.test(text)) return { result_version: 1 };
    throw new Error(`Unexpected query: ${text.trim().slice(0, 80)}`);
  }
}

function projectionArgs() {
  const result: CalculatedDailyResult = {
    workDate: '2026-08-03', scheduledPaidHours: 8, recordedElapsedHours: 8,
    proposedRegularHours: 8, proposedOvertimeHours: 0, proposedSundayHours: 0,
    proposedHolidayHours: 0, leaveHours: 0, unpaidHours: 0,
    attendanceClassification: null, status: 'approved', exceptionKinds: [],
    calculationFingerprint: 'fingerprint',
  };
  return { staffId: STAFF_ID, policyId: POLICY_ID, result };
}
