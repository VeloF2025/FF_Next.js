import type { TxnClient } from '@/lib/db-pool';
import { describe, expect, it } from 'vitest';

import { upsertDailyProjectionTxn } from '../projectionRepository';
import type { CalculatedDailyResult } from '../types';

const STAFF_ID = '00000000-0000-4000-8000-000000000001';
const POLICY_ID = '00000000-0000-4000-8000-000000000002';

class ProjectionTxn implements TxnClient {
  client = {} as TxnClient['client'];
  calls: Array<{ text: string; params: unknown[] }> = [];

  constructor(private readonly existing: Record<string, unknown> | null) {}

  async query(text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    this.calls.push({ text, params });
    return [{ acquired: true }];
  }

  async queryOne(text: string, params: unknown[] = []): Promise<Record<string, unknown> | null> {
    this.calls.push({ text, params });
    if (text.includes('attendance_weekly_locks')) return { active_period_lock: false };
    if (text.includes('SELECT calculation_fingerprint')) return this.existing;
    if (text.includes('SELECT overtime_rule_id')) return { overtime_rule_id: POLICY_ID };
    if (text.includes('INSERT INTO attendance_daily_summaries')) return { result_version: 1 };
    if (text.includes('UPDATE attendance_daily_summaries')) return { result_version: 2 };
    return null;
  }
}

function result(overrides: Partial<CalculatedDailyResult> = {}): CalculatedDailyResult {
  return {
    workDate: '2026-08-03', scheduledPaidHours: 8, recordedElapsedHours: 9,
    proposedRegularHours: 8, proposedOvertimeHours: 0, proposedSundayHours: 0,
    proposedHolidayHours: 0, leaveHours: 0, unpaidHours: 0,
    attendanceClassification: null, status: 'approved', exceptionKinds: [],
    calculationFingerprint: 'clean-v1', ...overrides,
  };
}

describe('system-approved daily projection persistence', () => {
  it('inserts every approved bucket including zeroes with system provenance', async () => {
    const tx = new ProjectionTxn(null);
    await upsertDailyProjectionTxn(tx, { staffId: STAFF_ID, policyId: POLICY_ID, result: result() });

    const insert = tx.calls.find((call) => call.text.includes('INSERT INTO attendance_daily_summaries'))!;
    expect(insert.text).toContain('approved_regular_hrs');
    expect(insert.text).toContain('approved_overtime_hrs');
    expect(insert.text).toContain('approved_sunday_hrs');
    expect(insert.text).toContain('approved_holiday_hrs');
    expect(insert.text).toContain('approved_at');
    expect(insert.text).toContain('approved_by');
    expect(insert.params.slice(15, 19)).toEqual([8, 0, 0, 0]);
  });

  it('maps an auto-approved public-holiday absence to the holiday bucket', async () => {
    const tx = new ProjectionTxn(null);
    await upsertDailyProjectionTxn(tx, {
      staffId: STAFF_ID,
      policyId: POLICY_ID,
      result: result({
        recordedElapsedHours: null,
        proposedRegularHours: null,
        attendanceClassification: 'public_holiday',
        calculationFingerprint: 'holiday-v1',
      }),
    });

    const insert = tx.calls.find((call) => call.text.includes('INSERT INTO attendance_daily_summaries'))!;
    expect(insert.params[11]).toBe('public_holiday');
    expect(insert.params.slice(15, 19)).toEqual([0, 0, 0, 8]);
  });

  it('repairs same-fingerprint legacy auto-approval buckets and provenance', async () => {
    const tx = new ProjectionTxn({
      calculation_fingerprint: 'clean-v1',
      result_version: 1,
      result_status: 'approved',
      approved_regular_hrs: null,
      approved_overtime_hrs: null,
      approved_sunday_hrs: null,
      approved_holiday_hrs: null,
      approved_at: null,
      approved_by: null,
    });

    await expect(upsertDailyProjectionTxn(tx, {
      staffId: STAFF_ID,
      policyId: POLICY_ID,
      result: result(),
    })).resolves.toEqual({ resultVersion: 2 });

    const update = tx.calls.find((call) => call.text.includes('result_version = ds.result_version + 1'));
    expect(update).toBeDefined();
    expect(update?.params.slice(15, 19)).toEqual([8, 0, 0, 0]);
    expect(tx.calls.some((call) => call.text.includes('SET computed_at = NOW()'))).toBe(false);
  });

  it('clears every stale approved field when recomputation becomes unresolved', async () => {
    const tx = new ProjectionTxn({
      calculation_fingerprint: 'clean-v1', result_version: 1, result_status: 'approved',
    });
    await upsertDailyProjectionTxn(tx, {
      staffId: STAFF_ID,
      policyId: POLICY_ID,
      result: result({
        status: 'awaiting_supervisor',
        exceptionKinds: ['late_arrival'],
        proposedRegularHours: null,
        calculationFingerprint: 'late-v2',
      }),
    });

    const update = tx.calls.find((call) => call.text.includes('UPDATE attendance_daily_summaries'))!;
    for (const field of [
      'approved_regular_hrs', 'approved_overtime_hrs',
      'approved_sunday_hrs', 'approved_holiday_hrs', 'approved_at',
    ]) {
      expect(update.text).toMatch(new RegExp(`${field}\\s*=\\s*CASE[\\s\\S]*?ELSE NULL END`));
    }
    expect(update.text).toMatch(/approved_by\s*=\s*NULL/);
  });
});
