/**
 * Integration Tests: superseded ONT serial retirement (ONT_LIFECYCLE_V2).
 *
 * Runs the real selection SQL from oesPostImportService against pg-mem, then
 * drives the real function with a pool bound to that database, so the assertions
 * cover the actual statements production runs — not a paraphrase of them.
 *
 * What is being protected:
 *   ONT_LIFECYCLE_V2 makes activation one-way, which is correct, but migration
 *   377's terminal state (decommissioned_at) had no writer. A swapped ONT left
 *   two rows on one drop, both 'activated' forever, and every consumer filtering
 *   on status alone counted the home twice.
 *
 * pg-mem limits worked around here: no window functions, no CTE attached to an
 * UPDATE, and no NOW() default on a column added mid-test.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { newDb, type IMemoryDb } from 'pg-mem';

// ── Flag + pool are module-level singletons in the service; control both ──────
const flagState = { on: true };
vi.mock('@/lib/featureFlags', () => ({
  isOntLifecycleV2Enabled: () => flagState.on,
}));

const poolRef: { query: (text: string, values?: unknown[]) => Promise<unknown> } = {
  query: async () => ({ rows: [], rowCount: 0 }),
};
vi.mock('@/lib/db', () => ({
  default: { query: (text: string, values?: unknown[]) => poolRef.query(text, values) },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

// Pulled in by the module under test; irrelevant to this behaviour.
vi.mock('@/modules/activate/services/serialVerificationService', () => ({
  computeAndPersistVerification: vi.fn(),
}));
vi.mock('../oesVlmLearningService', () => ({ recordVlmCorrectionsFromOes: vi.fn() }));
vi.mock('../oesSerialLifecycle', () => ({
  promoteOesActivatedSerials: vi.fn(),
  reconcileInStockOesActivated: vi.fn(async () => ({ scanned: 0 })),
}));

import { retireSupersededPpSerials } from '../oesPostImportService';

// ── Harness ──────────────────────────────────────────────────────────────────

function createDb(): IMemoryDb {
  const db = newDb();
  // pg-mem ships very few native functions; TRIM is one of the missing ones.
  db.public.registerFunction({
    name: 'trim',
    args: ['text'],
    returns: 'text',
    implementation: (s: string | null) => (s === null ? null : s.trim()),
  });
  db.public.none(`
    CREATE TABLE oes_pp_data (
      id                    SERIAL PRIMARY KEY,
      serial_number         TEXT NOT NULL,
      project               TEXT NOT NULL,
      resolution_status     TEXT NOT NULL DEFAULT 'not_found',
      resolved_drop_number  TEXT,
      activated_at          TIMESTAMPTZ,
      decommissioned_at     TIMESTAMPTZ,
      decommissioned_reason TEXT,
      updated_at            TIMESTAMPTZ
    )
  `);
  db.public.none(`
    CREATE TABLE ont_swap_records (
      id          SERIAL PRIMARY KEY,
      drop_number TEXT,
      old_serial  TEXT,
      new_serial  TEXT,
      status      TEXT
    )
  `);
  return db;
}

/**
 * Bind the service's pool to pg-mem through pg-mem's own pg adapter, so the
 * function under test sees real `$1` binding and a real `rowCount` — the value
 * it counts retirements with.
 */
function bindPool(db: IMemoryDb): void {
  const { Pool } = db.adapters.createPg();
  const pgPool = new Pool();
  poolRef.query = (text: string, values?: unknown[]) => pgPool.query(text, values);
}

function seedPp(
  db: IMemoryDb,
  rows: Array<{ serial: string; drop: string | null; activatedAt: string | null; status?: string }>,
): void {
  for (const r of rows) {
    db.public.none(`
      INSERT INTO oes_pp_data (serial_number, project, resolution_status, resolved_drop_number, activated_at, updated_at)
      VALUES ('${r.serial}', 'Lawley', '${r.status ?? 'activated'}',
              ${r.drop === null ? 'NULL' : `'${r.drop}'`},
              ${r.activatedAt === null ? 'NULL' : `'${r.activatedAt}'`},
              '2026-08-01')
    `);
  }
}

function ppState(db: IMemoryDb): Array<Record<string, unknown>> {
  return db.public.many(
    `SELECT serial_number, decommissioned_at, decommissioned_reason FROM oes_pp_data ORDER BY serial_number`,
  ) as Array<Record<string, unknown>>;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('retireSupersededPpSerials', () => {
  let db: IMemoryDb;

  beforeEach(() => {
    flagState.on = true;
    db = createDb();
    bindPool(db);
  });

  it('retires the older serial and keeps the newest activation on the drop', async () => {
    seedPp(db, [
      { serial: 'OLD1', drop: 'DR1', activatedAt: '2026-06-01' },
      { serial: 'NEW1', drop: 'DR1', activatedAt: '2026-07-01' },
    ]);

    const result = await retireSupersededPpSerials();

    expect(result.retired).toBe(1);
    expect(result.blockedNoActivatedAt).toBe(0);

    const state = ppState(db);
    const oldRow = state.find(r => r.serial_number === 'OLD1')!;
    const newRow = state.find(r => r.serial_number === 'NEW1')!;
    expect(oldRow.decommissioned_at).not.toBeNull();
    expect(oldRow.decommissioned_reason).toBe('superseded_by_serial:NEW1');
    // The live ONT is untouched — the whole point of the one-way lifecycle.
    expect(newRow.decommissioned_at).toBeNull();
  });

  it('credits a confirmed ONT swap record in the reason', async () => {
    seedPp(db, [
      { serial: 'OLD2', drop: 'DR2', activatedAt: '2026-06-01' },
      { serial: 'NEW2', drop: 'DR2', activatedAt: '2026-07-01' },
    ]);
    db.public.none(`
      INSERT INTO ont_swap_records (drop_number, old_serial, new_serial, status)
      VALUES ('DR2', 'old2', 'new2', 'confirmed_oes')
    `);

    await retireSupersededPpSerials();

    const oldRow = ppState(db).find(r => r.serial_number === 'OLD2')!;
    expect(oldRow.decommissioned_reason).toBe('ont_swap:NEW2');
  });

  it('leaves a single activated serial per drop alone', async () => {
    seedPp(db, [
      { serial: 'ONLY1', drop: 'DR3', activatedAt: '2026-06-01' },
      { serial: 'ONLY2', drop: 'DR4', activatedAt: '2026-06-01' },
    ]);

    const result = await retireSupersededPpSerials();

    expect(result.retired).toBe(0);
    expect(ppState(db).every(r => r.decommissioned_at === null)).toBe(true);
  });

  it('never retires a duplicate with no activated_at, and reports it', async () => {
    // The 377 constraint requires decommissioned_at >= activated_at, so these
    // rows are unretirable by construction. They must surface, not vanish.
    seedPp(db, [
      { serial: 'NOTS', drop: 'DR5', activatedAt: null },
      { serial: 'LIVE', drop: 'DR5', activatedAt: '2026-07-01' },
    ]);

    const result = await retireSupersededPpSerials();

    expect(result.retired).toBe(0);
    expect(result.blockedNoActivatedAt).toBe(1);
    expect(ppState(db).every(r => r.decommissioned_at === null)).toBe(true);
  });

  it('ignores non-activated rows and rows with no drop link', async () => {
    seedPp(db, [
      { serial: 'PEND', drop: 'DR6', activatedAt: null, status: 'located_local' },
      { serial: 'ACT', drop: 'DR6', activatedAt: '2026-07-01' },
      { serial: 'NODROP', drop: null, activatedAt: '2026-07-01' },
    ]);

    const result = await retireSupersededPpSerials();

    expect(result.retired).toBe(0);
    expect(result.blockedNoActivatedAt).toBe(0);
  });

  it('is a no-op while ONT_LIFECYCLE_V2 is off', async () => {
    flagState.on = false;
    seedPp(db, [
      { serial: 'OLD3', drop: 'DR7', activatedAt: '2026-06-01' },
      { serial: 'NEW3', drop: 'DR7', activatedAt: '2026-07-01' },
    ]);

    const result = await retireSupersededPpSerials();

    expect(result).toEqual({ retired: 0, blockedNoActivatedAt: 0 });
    expect(ppState(db).every(r => r.decommissioned_at === null)).toBe(true);
  });

  it('is idempotent across consecutive imports', async () => {
    seedPp(db, [
      { serial: 'OLD4', drop: 'DR8', activatedAt: '2026-06-01' },
      { serial: 'NEW4', drop: 'DR8', activatedAt: '2026-07-01' },
    ]);

    const first = await retireSupersededPpSerials();
    const second = await retireSupersededPpSerials();

    expect(first.retired).toBe(1);
    expect(second.retired).toBe(0);
  });
});
