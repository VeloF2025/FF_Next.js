/**
 * closeOesIntakeGap — receive ONTs that OES reports Active but stock never saw,
 * then promote every OES-active serial left sitting in_stock.
 *
 * The receive half already existed as a one-shot script nobody ran, so the gap
 * sat at 682 while the sync reported it every four hours and did nothing.
 *
 * The promotion set is deliberately NOT "what this run received". A serial that
 * was received but not promoted HAS a stock row, so the receive query can never
 * see it again — promoting only new rows would strand it as location-less
 * issuable stock forever. It also picks up phantom shelf stock created by the
 * SharePoint import (460 such serials at Tembelihle on 2026-08-20).
 */
import { describe, it, expect, vi } from 'vitest';
import { closeOesIntakeGap } from '../oesIntakeGap';
import type { GapQuerier } from '../oesIntakeGap';

const FT_ONT_ITEM_ID = '84cc2348-f8a9-486f-826a-6b8b20579765';

type Row = { serial_number: string; drop_number: string };

/**
 * Routes by query shape: the receive query starts FROM oes_activations, the
 * promotion query starts FROM stock_serials.
 */
function querier(missing: Row[], promotable: Row[], leftOver: Row[] = []): GapQuerier {
  // The promotable query runs TWICE: once to pick candidates, once afterwards
  // to measure what actually moved. `leftOver` is what the second call sees.
  let promotableCalls = 0;
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM oes_activations')) return { rows: missing };
    promotableCalls += 1;
    return { rows: promotableCalls === 1 ? promotable : leftOver };
  });
  return { query } as unknown as GapQuerier;
}

const MISSING: Row[] = [
  { serial_number: 'ALCLB4A11111', drop_number: 'DR1001' },
  { serial_number: 'ALCLB4A22222', drop_number: 'DR1002' },
];

describe('closeOesIntakeGap', () => {
  it('receives the missing serials and promotes them in the same run', async () => {
    const receive = vi.fn(async () => ({ received: 2, skipped: 0 }));
    const promote = vi.fn(async () => {});

    const report = await closeOesIntakeGap(querier(MISSING, MISSING), { receive, promote });

    expect(report).toEqual({ candidates: 2, received: 2, skipped: 0, promoted: 2, stillInStock: 0 });
    expect(promote.mock.calls[0]![0]).toEqual(MISSING);
  });

  it('receives with NO location, because OES knows the drop, not the warehouse', async () => {
    const receive = vi.fn(async () => ({ received: 2, skipped: 0 }));
    await closeOesIntakeGap(querier(MISSING, []), { receive, promote: vi.fn(async () => {}) });

    expect(receive.mock.calls[0]![0]).toEqual([
      { stockItemId: FT_ONT_ITEM_ID, serialNumber: 'ALCLB4A11111', locationId: null },
      { stockItemId: FT_ONT_ITEM_ID, serialNumber: 'ALCLB4A22222', locationId: null },
    ]);
  });

  it('promotes serials stranded by an EARLIER run, which the receive query cannot see', async () => {
    // The whole reason promotion is not scoped to this run's receives: these
    // already have stock rows, so they are not receive candidates — but they are
    // OES-active and sitting in_stock, i.e. phantom shelf stock.
    const stranded: Row[] = [{ serial_number: 'ALCLB4A99999', drop_number: 'DR9001' }];
    const receive = vi.fn(async () => ({ received: 0, skipped: 0 }));
    const promote = vi.fn(async () => {});

    const report = await closeOesIntakeGap(querier([], stranded), { receive, promote });

    expect(report).toEqual({ candidates: 0, received: 0, skipped: 0, promoted: 1, stillInStock: 0 });
    expect(receive).not.toHaveBeenCalled();
    expect(promote).toHaveBeenCalledWith(stranded);
  });

  it('promotes phantom shelf stock created by the sheet import', async () => {
    // Received from the workbook as warehouse stock, but OES says it is live at
    // a customer. Nothing else reconciles these.
    const phantom: Row[] = [
      { serial_number: 'ALCLB4A598FC', drop_number: 'DR7001' },
      { serial_number: 'ALCLB4A565C4', drop_number: 'DR7002' },
    ];
    const promote = vi.fn(async () => {});

    const report = await closeOesIntakeGap(querier([], phantom), {
      receive: vi.fn(async () => ({ received: 0, skipped: 0 })),
      promote,
    });

    expect(report.promoted).toBe(2);
  });

  it('promotes even when every serial was already present (skipped)', async () => {
    const receive = vi.fn(async () => ({ received: 0, skipped: 2 }));
    const promote = vi.fn(async () => {});

    const report = await closeOesIntakeGap(querier(MISSING, MISSING), { receive, promote });

    expect(report).toMatchObject({ received: 0, skipped: 2, promoted: 2 });
  });

  it('does nothing when there is neither a gap nor anything stuck in_stock', async () => {
    const receive = vi.fn(async () => ({ received: 0, skipped: 0 }));
    const promote = vi.fn(async () => {});

    const report = await closeOesIntakeGap(querier([], []), { receive, promote });

    expect(report).toEqual({ candidates: 0, received: 0, skipped: 0, promoted: 0, stillInStock: 0 });
    expect(receive).not.toHaveBeenCalled();
    expect(promote).not.toHaveBeenCalled();
  });

  it('still reports the receive when promotion throws, and flags it', async () => {
    const receive = vi.fn(async () => ({ received: 2, skipped: 0 }));
    const promote = vi.fn(async () => {
      throw new Error('promote exploded');
    });

    const report = await closeOesIntakeGap(querier(MISSING, MISSING), { receive, promote });

    expect(report).toMatchObject({ received: 2, promoted: 0, stillInStock: 2, promotionFailed: true });
  });

  it('does NOT count a serial as promoted when it is still in_stock afterwards', async () => {
    // promoteOesActivatedSerials swallows per-serial failures and never
    // rethrows, so "the call returned" proves nothing. Only re-measuring does.
    const stuck: Row[] = [{ serial_number: 'ALCLB4A22222', drop_number: 'DR1002' }];
    const report = await closeOesIntakeGap(querier(MISSING, MISSING, stuck), {
      receive: vi.fn(async () => ({ received: 2, skipped: 0 })),
      promote: vi.fn(async () => {}), // resolves happily, one serial never moves
    });

    expect(report).toMatchObject({ promoted: 1, stillInStock: 1, promotionFailed: true });
  });

  it('re-measures with the same query it selected candidates with', async () => {
    const db = querier(MISSING, MISSING);
    await closeOesIntakeGap(db, {
      receive: vi.fn(async () => ({ received: 2, skipped: 0 })),
      promote: vi.fn(async () => {}),
    });

    const calls = (db.query as unknown as { mock: { calls: [string, unknown[]?][] } }).mock.calls;
    // find-missing, find-promotable, re-measure
    expect(calls).toHaveLength(3);
    expect(calls[2]![0]).toBe(calls[1]![0]);
  });

  it('recomputes the promotion set AFTER the receive, not before', async () => {
    // Ordering matters: rows created by this run must be visible to the
    // promotion query, so it has to run second.
    const order: string[] = [];
    const db = {
      query: vi.fn(async (sql: string) => {
        order.push(sql.includes('FROM oes_activations') ? 'find-missing' : 'find-promotable');
        return { rows: sql.includes('FROM oes_activations') ? MISSING : MISSING };
      }),
    } as unknown as GapQuerier;

    await closeOesIntakeGap(db, {
      receive: vi.fn(async () => {
        order.push('receive');
        return { received: 2, skipped: 0 };
      }),
      promote: vi.fn(async () => {
        order.push('promote');
      }),
    });

    expect(order).toEqual(['find-missing', 'receive', 'find-promotable', 'promote', 'find-promotable']);
  });

  it('asks only for OES-active ALCL serials with no stock row', async () => {
    const db = querier(MISSING, []);
    await closeOesIntakeGap(db, {
      receive: vi.fn(async () => ({ received: 2, skipped: 0 })),
      promote: vi.fn(async () => {}),
    });

    const sql = (db.query as unknown as { mock: { calls: string[][] } }).mock.calls[0]![0]!;
    expect(sql).toContain('oes_activations');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('ALCL%');
  });

  it('only promotes serials whose stock row is in_stock', async () => {
    const db = querier(MISSING, MISSING);
    await closeOesIntakeGap(db, {
      receive: vi.fn(async () => ({ received: 2, skipped: 0 })),
      promote: vi.fn(async () => {}),
    });

    const promoteSql = (db.query as unknown as { mock: { calls: string[][] } }).mock.calls[1]![0]!;
    expect(promoteSql).toContain("ss.status = 'in_stock'");
    expect(promoteSql).toContain('FROM stock_serials');
  });

  it('bounds the promotion to FT-ONT serials, not anything OES mentions', async () => {
    // oes_activations is an external feed; an unbounded join would let a future
    // non-ONT row promote something else out of stock on a 4-hourly cron.
    const db = querier(MISSING, MISSING);
    await closeOesIntakeGap(db, {
      receive: vi.fn(async () => ({ received: 2, skipped: 0 })),
      promote: vi.fn(async () => {}),
    });

    const calls = (db.query as unknown as { mock: { calls: [string, unknown[]?][] } }).mock.calls;
    const [promoteSql, params] = calls[1]!;
    expect(promoteSql).toContain('ss.stock_item_id = $1');
    expect(promoteSql).toContain("ss.serial_number LIKE 'ALCL%'");
    expect(params).toEqual([FT_ONT_ITEM_ID]);
  });
});
