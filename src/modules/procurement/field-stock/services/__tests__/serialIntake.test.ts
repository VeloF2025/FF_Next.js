import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/serialEventContext', () => ({
  withSerialEventContext: vi.fn(
    async (_client: unknown, _context: unknown, operation: () => Promise<unknown>) => operation(),
  ),
}));
vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { receiveSerials } from '../serialIntake';

const STOCK_ITEM_ID = '84cc2348-f8a9-486f-826a-6b8b20579765';

function makePool(insertedPerChunk: number[]) {
  const remaining = [...insertedPerChunk];
  const query = vi.fn(async (sql: string) => ({
    rowCount: sql.includes('INSERT INTO stock_serials') ? remaining.shift() ?? 0 : null,
  }));
  const client = {
    query,
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;
  return { pool, client };
}

describe('receiveSerials batching', () => {
  it('receives each 500-row chunk with one set-based insert', async () => {
    const { pool, client } = makePool([500, 1]);
    const items = Array.from({ length: 501 }, (_, index) => ({
      stockItemId: STOCK_ITEM_ID,
      serialNumber: `ALCLB4${String(index).padStart(6, '0')}`,
      locationId: null,
    }));

    const result = await receiveSerials(pool, items, {
      sourceTable: 'ont_serial_sync',
      sourceId: '11111111-1111-4111-8111-111111111111',
      receivedReference: 'TEST',
    });

    expect(result).toEqual({ received: 501, skipped: 0 });
    expect(pool.connect).toHaveBeenCalledTimes(2);

    const inserts = client.query.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO stock_serials'),
    );
    expect(inserts).toHaveLength(2);
    expect(inserts[0]?.[0]).toMatch(/unnest\(/i);
    expect(inserts[0]?.[0]).toMatch(/ON CONFLICT \(stock_item_id, serial_number\) DO NOTHING/);

    const firstParams = inserts[0]?.[1] as unknown[];
    expect(firstParams[0]).toHaveLength(500);
    expect(firstParams[1]).toHaveLength(500);
    expect(firstParams[2]).toHaveLength(500);
    expect(firstParams[3]).toHaveLength(500);
  });

  it('counts conflicts as skipped without changing the set-based path', async () => {
    const { pool } = makePool([1]);

    const result = await receiveSerials(
      pool,
      [
        { stockItemId: STOCK_ITEM_ID, serialNumber: 'ALCLB4A', locationId: null },
        { stockItemId: STOCK_ITEM_ID, serialNumber: 'ALCLB4B', locationId: null },
      ],
      {
        sourceTable: 'ont_serial_sync',
        sourceId: '11111111-1111-4111-8111-111111111111',
        receivedReference: 'TEST',
      },
    );

    expect(result).toEqual({ received: 1, skipped: 1 });
  });
});
