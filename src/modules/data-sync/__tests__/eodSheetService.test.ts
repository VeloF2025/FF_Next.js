import { describe, it, expect, vi, beforeEach } from 'vitest';

// Both mocks go through vi.hoisted. vi.mock factories are hoisted above plain
// const declarations, so a factory closing over `const mockLogSerialChange`
// threw "Cannot access 'mockLogSerialChange' before initialization" at module
// load — the file collected 0 tests rather than failing one.
const { mockSql, mockLogSerialChange } = vi.hoisted(() => ({
  mockSql: vi.fn(),
  mockLogSerialChange: vi.fn(),
}));

// The service imports { sql, transaction } from '@/lib/db-pool'. This file used
// to mock '@/lib/db-neon' instead — a module the service no longer uses — so the
// real db-pool was in play and every query resolved to undefined ("Cannot read
// properties of undefined (reading 'rows')"). `transaction` is stubbed too:
// the service imports it, and a mock missing an imported export fails the file.
vi.mock('@/lib/db-pool', () => ({
  sql: mockSql,
  transaction: async (cb: (txn: { query: typeof mockSql }) => unknown) => cb({ query: mockSql }),
}));

vi.mock('@/modules/activate/services/activity-log/serialHistory', () => ({
  logSerialChange: mockLogSerialChange,
}));

// Import after mocks are hoisted
import { writeBackDrSerials } from '../services/eodSheetService';

const BASE_ENTRY = {
  rowNumber: 1,
  ontSerial: 'ALCLB48E0001',
  gizzuSerial: null,
  drNumber: 'DR-001',
  ponNumber: null,
  address: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockLogSerialChange.mockResolvedValue({ historyId: 'hist-1', activityId: 'act-1' });
});

describe('writeBackDrSerials', () => {
  it('skips entries missing drNumber', async () => {
    const result = await writeBackDrSerials(
      [{ ...BASE_ENTRY, drNumber: null }],
      'sheet-1',
      'user@vf.co.za'
    );
    expect(mockSql).not.toHaveBeenCalled();
    expect(result).toEqual({ matched_count: 0, logged_count: 0 });
  });

  it('skips entries missing ontSerial', async () => {
    const result = await writeBackDrSerials(
      [{ ...BASE_ENTRY, ontSerial: null }],
      'sheet-1',
      'user@vf.co.za'
    );
    expect(mockSql).not.toHaveBeenCalled();
    expect(result).toEqual({ matched_count: 0, logged_count: 0 });
  });

  it('skips and warns when DR not in dr_photo_unified_reviews', async () => {
    mockSql.mockResolvedValueOnce([]); // SELECT → no rows
    const result = await writeBackDrSerials([BASE_ENTRY], 'sheet-1', 'user@vf.co.za');
    expect(mockSql).toHaveBeenCalledTimes(1); // only SELECT, no UPDATE
    expect(result).toEqual({ matched_count: 0, logged_count: 0 });
  });

  it('fills null serial and increments matched_count', async () => {
    mockSql
      .mockResolvedValueOnce([{ ont_serial_scanned: null }]) // SELECT
      .mockResolvedValueOnce([{ '?column?': 1 }]);           // UPDATE RETURNING 1
    mockLogSerialChange.mockResolvedValueOnce({ historyId: 'h1', activityId: 'a1' });

    const result = await writeBackDrSerials([BASE_ENTRY], 'sheet-1', 'user@vf.co.za');
    expect(mockSql).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ matched_count: 1, logged_count: 1 });
  });

  it('does not increment matched_count when serial already set (UPDATE returns nothing)', async () => {
    mockSql
      .mockResolvedValueOnce([{ ont_serial_scanned: 'EXISTING123' }]) // SELECT
      .mockResolvedValueOnce([]);                                       // UPDATE → 0 rows
    mockLogSerialChange.mockResolvedValueOnce({ historyId: 'h1', activityId: 'a1' });

    const result = await writeBackDrSerials([BASE_ENTRY], 'sheet-1', 'user@vf.co.za');
    expect(result.matched_count).toBe(0);
    expect(result.logged_count).toBe(1); // still logged for audit
  });

  it('does not increment logged_count when logSerialChange returns empty historyId (no-op)', async () => {
    mockSql
      .mockResolvedValueOnce([{ ont_serial_scanned: null }])
      .mockResolvedValueOnce([{ '?column?': 1 }]);
    mockLogSerialChange.mockResolvedValueOnce({ historyId: '', activityId: '' });

    const result = await writeBackDrSerials([BASE_ENTRY], 'sheet-1', 'user@vf.co.za');
    expect(result.matched_count).toBe(1);
    expect(result.logged_count).toBe(0);
  });

  it('swallows logSerialChange errors and continues', async () => {
    mockSql
      .mockResolvedValueOnce([{ ont_serial_scanned: null }])
      .mockResolvedValueOnce([{ '?column?': 1 }]);
    mockLogSerialChange.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await writeBackDrSerials([BASE_ENTRY], 'sheet-1', 'user@vf.co.za');
    expect(result.matched_count).toBe(1);
    expect(result.logged_count).toBe(0); // not incremented — logSerialChange threw
  });

  it('processes multiple entries independently', async () => {
    mockSql
      .mockResolvedValueOnce([{ ont_serial_scanned: null }])  // DR-001 SELECT
      .mockResolvedValueOnce([{ '?column?': 1 }])             // DR-001 UPDATE
      .mockResolvedValueOnce([])                               // DR-002 SELECT → not found
      .mockResolvedValueOnce([{ ont_serial_scanned: 'OLD' }]) // DR-003 SELECT
      .mockResolvedValueOnce([]);                              // DR-003 UPDATE → already set
    mockLogSerialChange
      .mockResolvedValueOnce({ historyId: 'h1', activityId: 'a1' }) // DR-001
      .mockResolvedValueOnce({ historyId: 'h3', activityId: 'a3' }); // DR-003

    const result = await writeBackDrSerials(
      [
        { ...BASE_ENTRY, drNumber: 'DR-001', ontSerial: 'A' },
        { ...BASE_ENTRY, drNumber: 'DR-002', ontSerial: 'B' },
        { ...BASE_ENTRY, drNumber: 'DR-003', ontSerial: 'C' },
      ],
      'sheet-1',
      'user@vf.co.za'
    );
    expect(result).toEqual({ matched_count: 1, logged_count: 2 });
  });
});
