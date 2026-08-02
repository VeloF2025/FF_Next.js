import type { TxnClient } from '@/lib/db-pool';
import { describe, expect, it } from 'vitest';

import { MAX_JSON_PAYLOAD_BYTES, serializeJsonPayload } from '../jsonPayloadValidation';
import { upsertDailyProjectionTxn } from '../projectionRepository';
import type { CalculatedDailyResult } from '../types';

class NoSqlTxn implements TxnClient {
  calls: string[] = [];
  client = {} as TxnClient['client'];

  async query(): Promise<Record<string, unknown>[]> {
    this.calls.push('query');
    return [];
  }

  async queryOne(): Promise<Record<string, unknown> | null> {
    this.calls.push('queryOne');
    return null;
  }
}

function payloadAtSize(size: number): { payload: string } {
  const emptyPayloadBytes = Buffer.byteLength(JSON.stringify({ payload: '' }), 'utf8');
  return { payload: 'x'.repeat(size - emptyPayloadBytes) };
}

function oversizedResult(): CalculatedDailyResult {
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
    exceptionKinds: ['x'.repeat(MAX_JSON_PAYLOAD_BYTES) as never],
    calculationFingerprint: 'fingerprint',
  };
}

describe('serializeJsonPayload', () => {
  it('accepts a serialized UTF-8 payload at the byte limit', () => {
    const value = payloadAtSize(MAX_JSON_PAYLOAD_BYTES);

    const serialized = serializeJsonPayload(value);

    expect(Buffer.byteLength(serialized, 'utf8')).toBe(MAX_JSON_PAYLOAD_BYTES);
  });

  it('rejects a serialized UTF-8 payload above the byte limit', () => {
    const value = payloadAtSize(MAX_JSON_PAYLOAD_BYTES + 1);

    expect(() => serializeJsonPayload(value)).toThrow('JSON payload exceeds 1048576 bytes');
  });

  it('rejects an oversized projection before the transaction executes SQL', async () => {
    const tx = new NoSqlTxn();

    await expect(upsertDailyProjectionTxn(tx, {
      staffId: '00000000-0000-0000-0000-000000000001',
      policyId: '00000000-0000-0000-0000-000000000002',
      result: oversizedResult(),
    })).rejects.toThrow('JSON payload exceeds 1048576 bytes');

    expect(tx.calls).toEqual([]);
  });
});
