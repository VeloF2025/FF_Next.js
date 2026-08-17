/**
 * Integration test: loadPpActivatedOnListRows — the "PP — Linked" nightly sheet.
 *
 * Runs the REAL query against pg-mem through pg-mem's pg adapter, rather than
 * stubbing pool.query and asserting the rows the stub was handed. A stub-and-
 * assert test cannot fail when a WHERE clause disappears, which is exactly the
 * regression this file exists to catch.
 *
 * What is being protected:
 *   ONT_LIFECYCLE_V2 makes activation one-way. `resolution_status` is never moved
 *   off 'activated' — migration 377's CHECK has no terminal member — so
 *   terminal-ness is carried solely by `decommissioned_at`. A reader that filters
 *   on status alone therefore keeps reporting a superseded serial as live. This
 *   sheet was such a reader.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { newDb, type IMemoryDb } from 'pg-mem';

const poolRef: { query: (text: string, values?: unknown[]) => Promise<unknown> } = {
  query: async () => ({ rows: [], rowCount: 0 }),
};

vi.mock('@/lib/db', () => ({
  default: { query: (text: string, values?: unknown[]) => poolRef.query(text, values) },
  pool: { query: (text: string, values?: unknown[]) => poolRef.query(text, values) },
  query: (text: string, values?: unknown[]) => poolRef.query(text, values),
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { loadPpActivatedOnListRows } from '../queriesV2';

type Seed = {
  serial: string;
  project: string;
  batch: number;
  status?: string;
  decommissionedAt?: string | null;
  drop?: string | null;
};

function createDb(): IMemoryDb {
  const db = newDb();
  db.public.none(`
    CREATE TABLE oes_pp_data (
      id                   SERIAL PRIMARY KEY,
      serial_number        TEXT NOT NULL,
      project              TEXT,
      import_batch_id      INTEGER NOT NULL,
      resolution_status    TEXT NOT NULL DEFAULT 'not_found',
      resolved_drop_number TEXT,
      resolved_source      TEXT,
      linked_via           TEXT[],
      -- TEXT, not TIMESTAMPTZ: the query selects date_registered::text and
      -- pg-mem cannot cast timestamptz to text. Only the display column is
      -- loosened. decommissioned_at stays a real timestamp, because its NULL
      -- semantics are the thing under test and must not be approximated.
      date_registered      TEXT,
      activated_at         TIMESTAMPTZ,
      decommissioned_at    TIMESTAMPTZ
    )
  `);
  return db;
}

function bindPool(db: IMemoryDb): void {
  const { Pool } = db.adapters.createPg();
  const pgPool = new Pool();
  poolRef.query = (text: string, values?: unknown[]) => pgPool.query(text, values);
}

function seed(db: IMemoryDb, rows: Seed[]): void {
  for (const r of rows) {
    db.public.none(`
      INSERT INTO oes_pp_data
        (serial_number, project, import_batch_id, resolution_status,
         resolved_drop_number, resolved_source, date_registered, activated_at, decommissioned_at)
      VALUES (
        '${r.serial}', '${r.project}', ${r.batch}, '${r.status ?? 'activated'}',
        ${r.drop === undefined ? `'DR0001'` : r.drop === null ? 'NULL' : `'${r.drop}'`},
        'oes', '2026-08-01', '2026-08-01',
        ${r.decommissionedAt ? `'${r.decommissionedAt}'` : 'NULL'}
      )
    `);
  }
}

describe('loadPpActivatedOnListRows', () => {
  let db: IMemoryDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createDb();
    bindPool(db);
  });

  it('excludes a superseded serial and keeps the live one on the same drop', async () => {
    seed(db, [
      { serial: 'LIVE0001', project: 'MOA', batch: 7 },
      { serial: 'RETIRED01', project: 'MOA', batch: 7, decommissionedAt: '2026-08-10' },
    ]);

    const rows = await loadPpActivatedOnListRows();

    // Positive pin on WHY the count dropped: the surviving row is specifically
    // the non-decommissioned one, not merely "one fewer row".
    expect(rows.map((row) => row.serial_number)).toEqual(['LIVE0001']);
  });

  it('keeps every activated serial when none is decommissioned', async () => {
    seed(db, [
      { serial: 'AAA0001', project: 'MOA', batch: 7 },
      { serial: 'BBB0002', project: 'MOA', batch: 7 },
    ]);

    const rows = await loadPpActivatedOnListRows();

    // The filter must not narrow the normal case — the state production is in
    // today, before the retirement sweep stamps anything.
    expect(rows.map((row) => row.serial_number).sort()).toEqual(['AAA0001', 'BBB0002']);
  });

  it('still excludes rows that were never activated', async () => {
    seed(db, [
      { serial: 'ACTIVE001', project: 'MOA', batch: 7 },
      { serial: 'NOTFOUND1', project: 'MOA', batch: 7, status: 'not_found' },
      { serial: 'LOCATED01', project: 'MOA', batch: 7, status: 'located_1map' },
    ]);

    const rows = await loadPpActivatedOnListRows();

    expect(rows.map((row) => row.serial_number)).toEqual(['ACTIVE001']);
  });

  it('reads only the latest import batch per project', async () => {
    seed(db, [
      { serial: 'OLD00001', project: 'MOA', batch: 6 },
      { serial: 'NEW00001', project: 'MOA', batch: 7 },
      { serial: 'OTHER001', project: 'LAWLEY', batch: 3 },
    ]);

    const rows = await loadPpActivatedOnListRows();

    // Latest batch per project, independently per project — LAWLEY's max is 3.
    expect(rows.map((row) => row.serial_number).sort()).toEqual(['NEW00001', 'OTHER001']);
  });

  it('excludes a decommissioned row even when it is the only row on its drop', async () => {
    seed(db, [
      { serial: 'SOLO0001', project: 'MOA', batch: 7, drop: 'DR9999', decommissionedAt: '2026-08-11' },
    ]);

    const rows = await loadPpActivatedOnListRows();

    // Guards against a fix that only deduplicates rivals on a shared drop: a
    // retired serial is off-list on its own merits, not because a live sibling
    // outranked it.
    expect(rows).toEqual([]);
  });
});
