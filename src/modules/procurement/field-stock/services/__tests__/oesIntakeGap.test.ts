/**
 * closeOesIntakeGap — receive ONTs that OES reports Active but stock never saw,
 * then promote them in the SAME run.
 *
 * The receive half already existed as a one-shot script nobody ran, so the gap
 * sat at 682 while the sync reported it every four hours and did nothing.
 *
 * Promoting in the same run is the point of the design: a received-but-not-yet-
 * promoted serial sits as `in_stock` with NO location, and a serial with no
 * location is issuable from ANY warehouse. Those ONTs are already installed at
 * customers, so leaving that window open would put 682 phantom units on the
 * shelf until the next OES import happened to run.
 */
import { describe, it, expect, vi } from 'vitest';
import { closeOesIntakeGap } from '../oesIntakeGap';
import type { GapQuerier } from '../oesIntakeGap';

const FT_ONT_ITEM_ID = '84cc2348-f8a9-486f-826a-6b8b20579765';

function querier(gapRows: Array<{ serial_number: string; drop_number: string }>): GapQuerier {
  return {
    query: vi.fn(async () => ({ rows: gapRows })),
  } as unknown as GapQuerier;
}

const GAP = [
  { serial_number: 'ALCLB4A11111', drop_number: 'DR1001' },
  { serial_number: 'ALCLB4A22222', drop_number: 'DR1002' },
];

describe('closeOesIntakeGap', () => {
  it('receives the missing serials and promotes them in the same run', async () => {
    const receive = vi.fn(async () => ({ received: 2, skipped: 0 }));
    const promote = vi.fn(async () => {});

    const report = await closeOesIntakeGap(querier(GAP), { receive, promote });

    expect(report).toEqual({ candidates: 2, received: 2, skipped: 0, promoted: 2 });
    expect(receive).toHaveBeenCalledTimes(1);
    expect(promote).toHaveBeenCalledTimes(1);
    // Promotion must cover exactly what was received — not a subset.
    expect(promote.mock.calls[0]![0]).toEqual(GAP);
  });

  it('receives with NO location, because OES cannot say which warehouse', async () => {
    const receive = vi.fn(async () => ({ received: 2, skipped: 0 }));
    await closeOesIntakeGap(querier(GAP), { receive, promote: vi.fn(async () => {}) });

    const items = receive.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(items).toEqual([
      { stockItemId: FT_ONT_ITEM_ID, serialNumber: 'ALCLB4A11111', locationId: null },
      { stockItemId: FT_ONT_ITEM_ID, serialNumber: 'ALCLB4A22222', locationId: null },
    ]);
  });

  it('promotes even when every serial was already present (skipped)', async () => {
    // A re-run must still promote: the receive is idempotent and reports
    // skipped, but a serial stuck in_stock from a previous run still needs
    // moving off the shelf.
    const receive = vi.fn(async () => ({ received: 0, skipped: 2 }));
    const promote = vi.fn(async () => {});

    const report = await closeOesIntakeGap(querier(GAP), { receive, promote });

    expect(report).toMatchObject({ received: 0, skipped: 2 });
    expect(promote).toHaveBeenCalledTimes(1);
  });

  it('does no work and calls nothing when the gap is empty', async () => {
    const receive = vi.fn(async () => ({ received: 0, skipped: 0 }));
    const promote = vi.fn(async () => {});

    const report = await closeOesIntakeGap(querier([]), { receive, promote });

    expect(report).toEqual({ candidates: 0, received: 0, skipped: 0, promoted: 0 });
    expect(receive).not.toHaveBeenCalled();
    expect(promote).not.toHaveBeenCalled();
  });

  it('still reports the receive even if promotion throws', async () => {
    // Promotion failing must not lose the fact that stock rows were created,
    // nor abort the surrounding sheet sync.
    const receive = vi.fn(async () => ({ received: 2, skipped: 0 }));
    const promote = vi.fn(async () => {
      throw new Error('promote exploded');
    });

    const report = await closeOesIntakeGap(querier(GAP), { receive, promote });

    expect(report).toMatchObject({ received: 2, promoted: 0, promotionFailed: true });
  });

  it('asks only for OES-active ALCL serials with no stock row', async () => {
    const db = querier(GAP);
    await closeOesIntakeGap(db, { receive: vi.fn(async () => ({ received: 2, skipped: 0 })), promote: vi.fn(async () => {}) });

    const sql = (db.query as unknown as { mock: { calls: string[][] } }).mock.calls[0]![0]!;
    expect(sql).toContain('oes_activations');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('ALCL%');
  });
});
