import type { TxnClient } from '@/lib/db-pool';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const transactionMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db-pool', () => ({ transaction: transactionMock }));

import {
  persistCalculatedDay,
  syncDayExceptionsTxn,
  upsertDailyProjectionTxn,
} from '../projectionRepository';
import type { CalculatedDailyResult } from '../types';

const STAFF_ID = '00000000-0000-0000-0000-000000000001';
const ENTRY_ID = '00000000-0000-0000-0000-000000000002';
const POLICY_ID = '00000000-0000-0000-0000-000000000003';

interface QueryCall {
  text: string;
  params: unknown[];
}

class RecordingTxn implements TxnClient {
  calls: QueryCall[] = [];
  client = {} as TxnClient['client'];

  constructor(
    private readonly queryOneRows: Array<Record<string, unknown> | null> = [],
    private readonly afterQueryOne?: (call: QueryCall) => void,
  ) {}

  async query(text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    this.calls.push({ text, params });
    return /pg_advisory_xact_lock/i.test(text) ? [{ acquired: '' }] : [];
  }

  async queryOne(text: string, params: unknown[] = []): Promise<Record<string, unknown> | null> {
    const call = { text, params };
    this.calls.push(call);
    this.afterQueryOne?.(call);
    if (text.includes('attendance_weekly_locks')) return { active_period_lock: false };
    return this.queryOneRows.shift() ?? null;
  }
}

class StatefulTxn extends RecordingTxn {
  projection: { calculation_fingerprint: string; result_version: number } | null = null;
  exceptions = new Map<string, string>();
  projectionInserts = 0;

  override async queryOne(text: string, params: unknown[] = []): Promise<Record<string, unknown> | null> {
    this.calls.push({ text, params });
    if (text.includes('attendance_weekly_locks')) return { active_period_lock: false };
    if (text.includes('SELECT calculation_fingerprint')) return this.projection;
    if (text.includes('SELECT overtime_rule_id')) return { overtime_rule_id: POLICY_ID };
    if (text.includes('INSERT INTO attendance_daily_summaries')) {
      this.projection = { calculation_fingerprint: String(params[14]), result_version: 1 };
      this.projectionInserts += 1;
      return { result_version: 1 };
    }
    if (text.includes('SET computed_at = NOW()')) {
      return { result_version: this.projection?.result_version ?? 0 };
    }
    if (text.includes('INSERT INTO attendance_day_exceptions')) {
      const key = String(params[7]);
      const id = this.exceptions.get(key) ?? '00000000-0000-0000-0000-000000000004';
      this.exceptions.set(key, id);
      return { id };
    }
    throw new Error(`Unexpected stateful repository query: ${text.trim().slice(0, 60)}`);
  }
}

class AdjustedExceptionTxn extends RecordingTxn {
  status: 'awaiting_supervisor' | 'awaiting_worker' = 'awaiting_supervisor';
  adjustmentId: string | null = '00000000-0000-0000-0000-000000000005';

  override async queryOne(text: string, params: unknown[] = []): Promise<Record<string, unknown> | null> {
    this.calls.push({ text, params });
    if (text.includes('INSERT INTO attendance_day_exceptions')) {
      const preservesAdjustedStatus = text.includes(
        "attendance_day_exceptions.adjustment_id IS NOT NULL"
      ) && text.includes("attendance_day_exceptions.status = 'awaiting_supervisor'");
      if (!preservesAdjustedStatus) this.status = String(params[4]) as 'awaiting_worker';
      return { id: '00000000-0000-0000-0000-000000000004' };
    }
    return null;
  }
}

function missingClockOutResult(fingerprint = 'fingerprint'): CalculatedDailyResult {
  return {
    workDate: '2026-08-03',
    scheduledPaidHours: 8,
    recordedElapsedHours: null,
    proposedRegularHours: 8,
    proposedOvertimeHours: 0,
    proposedSundayHours: 0,
    proposedHolidayHours: 0,
    leaveHours: 0,
    unpaidHours: 0,
    attendanceClassification: null,
    status: 'awaiting_worker',
    exceptionKinds: ['missing_clock_out'],
    calculationFingerprint: fingerprint,
  };
}

function multiExceptionResult(): CalculatedDailyResult {
  return { ...missingClockOutResult(), exceptionKinds: ['late_arrival', 'early_departure'] };
}

describe('attendance policy projection repository', () => {
  beforeEach(() => {
    transactionMock.mockReset();
  });

  it('replays the real repository transaction without changing version or exception identity', async () => {
    const tx = new StatefulTxn();
    transactionMock.mockImplementation(async (work: (client: TxnClient) => unknown) => work(tx));
    const args = {
      staffId: STAFF_ID,
      entryId: ENTRY_ID,
      policyId: POLICY_ID,
      result: missingClockOutResult(),
    };

    const first = await persistCalculatedDay(args);
    const second = await persistCalculatedDay(args);

    expect(first).toEqual({ resultVersion: 1, exceptionIds: ['00000000-0000-0000-0000-000000000004'] });
    expect(second).toEqual(first);
    expect(tx.projectionInserts).toBe(1);
    expect(tx.projection).toEqual({ calculation_fingerprint: 'fingerprint', result_version: 1 });
    expect([...tx.exceptions.keys()]).toEqual([
      `attendance:2026-08-03:missing_clock_out:${STAFF_ID}`,
    ]);
    expect(transactionMock).toHaveBeenCalledTimes(2);
  });

  it('increments result version when the calculation fingerprint changes', async () => {
    const tx = new RecordingTxn([
      { calculation_fingerprint: 'old-fingerprint', result_version: '1' },
      { result_version: '2' },
    ]);

    const projection = await upsertDailyProjectionTxn(tx, {
      staffId: STAFF_ID,
      policyId: POLICY_ID,
      result: missingClockOutResult(),
    });

    expect(projection).toEqual({ resultVersion: 2 });
    expect(tx.calls.find((call) => call.text.includes('result_version = ds.result_version + 1'))).toBeDefined();
  });

  it('preserves awaiting-supervisor daily state when a pending adjusted exception exists', async () => {
    const tx = new RecordingTxn([
      { calculation_fingerprint: 'old-fingerprint', result_version: '1' },
      { result_version: '2' },
    ]);

    await upsertDailyProjectionTxn(tx, {
      staffId: STAFF_ID,
      policyId: POLICY_ID,
      result: missingClockOutResult('changed-fingerprint'),
    });

    const replaceSql = tx.calls.find((call) => call.text.includes('result_status = CASE'))?.text ?? '';
    expect(replaceSql).toContain("ds.result_status = 'awaiting_supervisor'");
    expect(replaceSql).toContain('de.adjustment_id IS NOT NULL');
    expect(replaceSql).toContain("de.status = 'awaiting_supervisor'");
  });

  it('preserves result version when the calculation fingerprint is identical', async () => {
    const tx = new RecordingTxn([
      { calculation_fingerprint: 'fingerprint', result_version: '1' },
      { result_version: '1' },
    ]);

    const projection = await upsertDailyProjectionTxn(tx, {
      staffId: STAFF_ID,
      policyId: POLICY_ID,
      result: missingClockOutResult(),
    });

    expect(projection).toEqual({ resultVersion: 1 });
    expect(tx.calls.some((call) => call.text.includes('SET computed_at = NOW()'))).toBe(true);
  });

  it('uses worker/date/kind as the stable exception identity and cancels obsolete unresolved kinds', async () => {
    const tx = new RecordingTxn([{ id: '00000000-0000-0000-0000-000000000004' }]);

    const exceptionIds = await syncDayExceptionsTxn(tx, {
      staffId: STAFF_ID,
      entryId: ENTRY_ID,
      resultVersion: 1,
      result: missingClockOutResult(),
    });

    expect(exceptionIds).toEqual(['00000000-0000-0000-0000-000000000004']);
    expect(tx.calls[0]?.params).toContain(`attendance:2026-08-03:missing_clock_out:${STAFF_ID}`);
    expect(tx.calls[0]?.text).toContain('ON CONFLICT (idempotency_key)');
    expect(tx.calls[1]?.text).toContain("SET status = 'cancelled'");
    expect(tx.calls[1]?.text).toContain("status IN ('open', 'awaiting_worker', 'awaiting_supervisor')");
    expect(tx.calls[1]?.text).toContain('adjustment_id IS NULL');
  });

  it('preserves a submitted correction in awaiting-supervisor during idempotent re-sync', async () => {
    const tx = new AdjustedExceptionTxn();

    await syncDayExceptionsTxn(tx, {
      staffId: STAFF_ID,
      entryId: ENTRY_ID,
      resultVersion: 2,
      result: missingClockOutResult(),
    });

    expect(tx.status).toBe('awaiting_supervisor');
    expect(tx.adjustmentId).toBe('00000000-0000-0000-0000-000000000005');
    expect(tx.calls[0]?.text).toContain(
      "attendance_day_exceptions.status IN ('resolved', 'cancelled')"
    );
  });

  it('uses the null-entry SQL branch when no evidence entry exists', async () => {
    const tx = new RecordingTxn([{ id: '00000000-0000-0000-0000-000000000004' }]);

    await syncDayExceptionsTxn(tx, {
      staffId: STAFF_ID,
      entryId: null,
      resultVersion: 1,
      result: missingClockOutResult(),
    });

    expect(tx.calls[0]?.text).toContain('NULL::uuid');
    expect(tx.calls[0]?.params).not.toContain(ENTRY_ID);
  });

  it('serializes each exception payload immediately before its own SQL branch', async () => {
    const result = multiExceptionResult();
    const tx = new RecordingTxn([
      { id: '00000000-0000-0000-0000-000000000004' },
      { id: '00000000-0000-0000-0000-000000000005' },
    ], (call) => {
      if (call.params.includes('attendance:2026-08-03:late_arrival:' + STAFF_ID)) {
        result.proposedRegularHours = 6;
      }
    });

    await syncDayExceptionsTxn(tx, { staffId: STAFF_ID, entryId: ENTRY_ID, resultVersion: 1, result });

    expect(tx.calls[0]?.params).toContain('{"scheduledPaidHours":8,"recordedElapsedHours":null,"proposedRegularHours":8,"proposedOvertimeHours":0,"proposedSundayHours":0,"proposedHolidayHours":0,"leaveHours":0,"unpaidHours":0}');
    expect(tx.calls[1]?.params).toContain('{"scheduledPaidHours":8,"recordedElapsedHours":null,"proposedRegularHours":6,"proposedOvertimeHours":0,"proposedSundayHours":0,"proposedHolidayHours":0,"leaveHours":0,"unpaidHours":0}');
  });

  it('takes the staff/date advisory lock before reading a missing projection', async () => {
    const tx = new RecordingTxn([null, { overtime_rule_id: POLICY_ID }, { result_version: '1' }]);

    const projection = await upsertDailyProjectionTxn(tx, {
      staffId: STAFF_ID,
      policyId: POLICY_ID,
      result: missingClockOutResult(),
    });

    expect(projection).toEqual({ resultVersion: 1 });
    expect(tx.calls[0]?.params).toEqual(['attendance-week-lock', '2026-08-03']);
    expect(tx.calls[1]?.params).toEqual([STAFF_ID, '2026-08-03']);
    expect(tx.calls.find((call) => call.text.includes('SELECT calculation_fingerprint'))?.text).toContain('FOR UPDATE');
    expect(tx.calls.some((call) => call.text.includes('overtime_rule_id'))).toBe(true);
    expect(tx.calls.some((call) => call.text.includes('INSERT INTO attendance_daily_summaries'))).toBe(true);
  });

  it('fails clearly before insert when the policy has no legacy overtime rule', async () => {
    const tx = new RecordingTxn([null, { overtime_rule_id: null }]);

    await expect(upsertDailyProjectionTxn(tx, {
      staffId: STAFF_ID,
      policyId: POLICY_ID,
      result: missingClockOutResult(),
    })).rejects.toThrow('has no overtime_rule_id for legacy rule_id');

    expect(tx.calls).toHaveLength(5);
    expect(tx.calls.some((call) => call.text.includes('INSERT INTO attendance_daily_summaries'))).toBe(false);
  });
});
