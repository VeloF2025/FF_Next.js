/**
 * PPE acknowledgement sheets — the parts that are decisions rather than SQL.
 *
 * The database invariants (one open sheet per worker, the exclusive worker arc,
 * the cascade) are asserted against real Postgres in
 * tests/migrations/489_hs_ppe_acknowledgements.test.ts. What is left here is the
 * behaviour the service chooses:
 *
 *   - `startSheet` must close the previous sheet and insert the new one INSIDE
 *     one transaction. Doing it in two calls leaves a window where a concurrent
 *     request sees no open sheet and opens a second, and the partial unique
 *     index then rejects one of them at random.
 *   - a sheet counts as evidenced by an uploaded scan OR an in-app signature,
 *     never by merely existing.
 *   - the worker is one of two columns, and picking the wrong one silently
 *     returns another worker's sheet.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: { current: [] as Array<{ text: string; params: unknown[] }> },
  txnCalls: { current: [] as Array<{ text: string; params: unknown[] }> },
  inTransaction: { current: false },
  transactionRan: { current: false },
  oneRow: { current: null as Record<string, unknown> | null },
}));

vi.mock('@/lib/db-pool', () => ({
  query: vi.fn(async (text: string, params: unknown[] = []) => {
    h.calls.current.push({ text, params });
    return [{ id: 'sheet-new' }];
  }),
  queryOne: vi.fn(async (text: string, params: unknown[] = []) => {
    h.calls.current.push({ text, params });
    return h.oneRow.current;
  }),
  transaction: vi.fn(async (cb: (txn: unknown) => Promise<unknown>) => {
    h.transactionRan.current = true;
    h.inTransaction.current = true;
    const txn = {
      query: async (text: string, params: unknown[] = []) => {
        h.txnCalls.current.push({ text, params });
        return [{ id: 'sheet-new' }];
      },
      queryOne: async () => null,
    };
    try {
      return await cb(txn);
    } finally {
      h.inTransaction.current = false;
    }
  }),
}));

import {
  PpeAcknowledgementConflict,
  closeSheet,
  countUnevidencedIssuances,
  listSheetsFor,
  openSheetFor,
  startSheet,
} from '../services/ppeAcknowledgementService';

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

beforeEach(() => {
  h.calls.current = [];
  h.txnCalls.current = [];
  h.transactionRan.current = false;
  h.oneRow.current = { id: 'sheet-new', status: 'open' };
});

describe('startSheet', () => {
  it('closes the previous sheet and inserts the new one in ONE transaction', async () => {
    await startSheet({
      worker: { staffId: 'staff-1' },
      workerName: 'Test Worker',
      actorUserId: 'user-1',
    });

    expect(h.transactionRan.current).toBe(true);

    const inTxn = h.txnCalls.current.map((c) => squash(c.text));
    expect(inTxn).toHaveLength(2);
    // Order matters: the index permits only one open sheet, so the close must
    // precede the insert.
    expect(inTxn[0]).toMatch(/UPDATE hs_ppe_acknowledgements.*status = 'closed'/);
    expect(inTxn[1]).toMatch(/INSERT INTO hs_ppe_acknowledgements/);

    // Neither statement may have run outside the transaction.
    const outside = h.calls.current.map((c) => squash(c.text));
    expect(outside.some((q) => /INSERT INTO hs_ppe_acknowledgements/.test(q))).toBe(false);
    expect(outside.some((q) => /status = 'closed'/.test(q))).toBe(false);
  });

  it('closes only the given worker\'s open sheet', async () => {
    await startSheet({
      worker: { staffId: 'staff-1' },
      workerName: 'Test Worker',
      actorUserId: 'user-1',
    });

    const close = h.txnCalls.current[0]!;
    expect(squash(close.text)).toContain('staff_id');
    expect(squash(close.text)).not.toContain('team_member_id');
    expect(squash(close.text)).toContain("status = 'open'");
    expect(close.params).toContain('staff-1');
  });

  it('writes team_member_id when the worker is a contractor crew member', async () => {
    await startSheet({
      worker: { teamMemberId: 'tm-1' },
      workerName: 'Crew Worker',
      actorUserId: 'user-1',
    });

    const insert = squash(h.txnCalls.current[1]!.text);
    expect(insert).toContain('team_member_id');
    // Would silently file the sheet against the wrong worker column.
    expect(insert).not.toContain('staff_id');
  });
});

describe('sheet lookups', () => {
  it('reads the open sheet by the correct worker column', async () => {
    await openSheetFor({ staffId: 'staff-1' });
    const q = squash(h.calls.current.at(-1)!.text);
    expect(q).toContain('a.staff_id = $1');
    expect(q).toContain("a.status = 'open'");

    h.calls.current = [];
    await openSheetFor({ teamMemberId: 'tm-1' });
    expect(squash(h.calls.current.at(-1)!.text)).toContain('a.team_member_id = $1');
  });

  it('derives is_evidenced from a scan OR an in-app signature', async () => {
    await listSheetsFor({ staffId: 'staff-1' });
    const q = squash(h.calls.current.at(-1)!.text);
    // A sheet that merely exists is not evidence; one of the two must hold.
    expect(q).toContain('COALESCE(att.n, 0) > 0 OR a.signature_name IS NOT NULL');
  });

  it('never selects file_path from attachments', async () => {
    await listSheetsFor({ staffId: 'staff-1' });
    // Storage paths must not reach a client; the bytes are served only by the
    // permission-checked download route.
    expect(squash(h.calls.current.at(-1)!.text)).not.toContain('file_path');
  });

  it('parameterises the worker id', async () => {
    await openSheetFor({ staffId: "'; DROP TABLE hs_ppe_acknowledgements; --" });
    const call = h.calls.current.at(-1)!;
    expect(call.text).toContain('$1');
    expect(call.text).not.toContain('DROP TABLE');
    expect(call.params).toContain("'; DROP TABLE hs_ppe_acknowledgements; --");
  });
});

describe('closeSheet', () => {
  it('only closes a sheet that is currently open', async () => {
    await closeSheet('sheet-1');
    const q = squash(h.calls.current.at(-1)!.text);
    // Without this the call would report success for an already-closed sheet.
    expect(q).toContain("status = 'open'");
    expect(q).toContain('RETURNING id');
  });
});

describe('countUnevidencedIssuances', () => {
  it('counts issuances whose worker has no evidenced sheet', async () => {
    h.oneRow.current = { n: 3 };
    expect(await countUnevidencedIssuances()).toBe(3);

    const q = squash(h.calls.current.at(-1)!.text);
    expect(q).toContain('FROM hs_ppe_issuance');
    expect(q).toContain('NOT EXISTS');
    // Must match on either worker column — matching only staff_id would report
    // every contractor crew member as unevidenced forever.
    expect(q).toContain('a.staff_id = i.staff_id');
    expect(q).toContain('a.team_member_id = i.team_member_id');
    expect(q).toContain('att.n > 0 OR a.signature_name IS NOT NULL');
  });

  it('reports zero rather than null when nothing matches', async () => {
    h.oneRow.current = null;
    // A null here would render as "NaN unevidenced" in the register banner.
    expect(await countUnevidencedIssuances()).toBe(0);
  });

  it('excludes name-only issuances, which can never be evidenced', async () => {
    h.oneRow.current = { n: 0 };
    await countUnevidencedIssuances();

    const q = squash(h.calls.current.at(-1)!.text);
    // hs_ppe_issuance's constraint is at_most_one_worker — zero workers is
    // legal, and migration 453 records that field crews routinely include
    // workers in neither table. Such a row can never match a sheet, so counting
    // it would inflate the banner permanently AND tell the user to upload a
    // sheet for a row the panel correctly refuses to offer one for.
    expect(q).toContain('i.staff_id IS NOT NULL OR i.team_member_id IS NOT NULL');
  });
});

describe('startSheet — losing a race', () => {
  it('raises a typed conflict on a unique violation rather than a raw error', async () => {
    const { transaction } = await import('@/lib/db-pool');
    (transaction as unknown as { mockRejectedValueOnce: (e: unknown) => void })
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'hs_ppe_ack_one_open_per_worker',
      }));

    // The partial unique index genuinely refuses the second open sheet, so the
    // loser must surface as a 409, not a 500.
    await expect(
      startSheet({ worker: { staffId: 'staff-1' }, workerName: 'W', actorUserId: 'u' })
    ).rejects.toBeInstanceOf(PpeAcknowledgementConflict);
  });

  it('does not treat a DIFFERENT unique violation as the race', async () => {
    const { transaction } = await import('@/lib/db-pool');
    (transaction as unknown as { mockRejectedValueOnce: (e: unknown) => void })
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'some_other_unique_index',
      }));

    // Same SQLSTATE, different constraint. Reporting this as "someone else got
    // there first" would present a genuine bug as a benign conflict — and the
    // only reason it cannot happen today is that no such constraint exists yet.
    await expect(
      startSheet({ worker: { staffId: 'staff-1' }, workerName: 'W', actorUserId: 'u' })
    ).rejects.not.toBeInstanceOf(PpeAcknowledgementConflict);
  });

  it('does not swallow unrelated database errors', async () => {
    const { transaction } = await import('@/lib/db-pool');
    (transaction as unknown as { mockRejectedValueOnce: (e: unknown) => void })
      .mockRejectedValueOnce(Object.assign(new Error('connection reset'), { code: '08006' }));

    // Translating every failure into a conflict would hide real faults behind a
    // "reload and try again" the user can never satisfy.
    await expect(
      startSheet({ worker: { staffId: 'staff-1' }, workerName: 'W', actorUserId: 'u' })
    ).rejects.not.toBeInstanceOf(PpeAcknowledgementConflict);
  });
});
