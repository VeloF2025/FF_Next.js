/**
 * tests/db/services/field-stock/serialForceCorrect.test.ts
 *
 * Integration tests for forceCorrectSerials(). Runs against the Wave-1
 * docker-compose harness (boot via:
 *   docker-compose -f tests/db/setup/docker-compose.test.yml up -d).
 *
 * Pattern mirrors searchSerials.test.ts / serialTimeline.test.ts:
 *   INSERT-only with PR9B-FC-prefixed serial numbers + cccccccc… UUIDs.
 *   Targeted DELETE in afterAll inside try/finally so pool.end() always fires.
 *   No TRUNCATE — would wipe the shared seed used by tests/db/triggers.
 *
 * Test DB URL comes from DATABASE_URL_TEST set by global-setup.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Pool } from 'pg';
import { forceCorrectSerials } from '@/modules/procurement/field-stock/services/serialForceCorrectService';

const TEST_DB_URL = process.env.DATABASE_URL_TEST;
if (!TEST_DB_URL) {
  throw new Error(
    'DATABASE_URL_TEST not set — boot tests/db/setup/docker-compose.test.yml or run via `npm run test:db`.'
  );
}

// ============================================================================
// Fixed UUIDs — distinct from seed + sibling test files to avoid collisions.
// Prefix "cccccccc-…" (seed uses 11…/22…/33…/44…/55…/66…/77…/88…/99…/aa…/bb…/10…/cc000000-0001/cc000000-0002).
// PR8 tests use aaaaaaaa-000…001-004; PR9A tests use bbbbbbbb-000…001-003.
// PR9B-FC tests use cccccccc-000…001-002.
// ============================================================================

const ITEM_ONT      = 'cccccccc-0000-0000-0000-000000000001';
const WAREHOUSE_FC  = 'cccccccc-0000-0000-0000-000000000002';

// Reuse the seeded user row — 22222222… is always present (seed.sql line 29).
const TEST_USER_ID  = '22222222-2222-2222-2222-222222222222';
const PERFORMED_BY_NAME = 'Force Correct Tester';

const SN_A = 'PR9B-FC-A';
const SN_B = 'PR9B-FC-B';

const pool = new Pool({ connectionString: TEST_DB_URL });

// ============================================================================
// Setup / teardown
// ============================================================================

beforeAll(async () => {
  await pool.query(
    `INSERT INTO stock_items (id, item_code, name, category, tracking_type)
     VALUES ($1, 'PR9B-FC-ONT', 'PR9B FC Test ONT', 'ONT', 'serial')
     ON CONFLICT (id) DO NOTHING`,
    [ITEM_ONT],
  );
  await pool.query(
    `INSERT INTO stock_locations (id, code, name, location_type)
     VALUES ($1, 'PR9B-FC-WH', 'PR9B FC Warehouse', 'warehouse')
     ON CONFLICT (id) DO NOTHING`,
    [WAREHOUSE_FC],
  );
  // Two test serials, always starting at a known state (reset by beforeEach).
  // ON CONFLICT for idempotent re-runs.
  await pool.query(
    `INSERT INTO stock_serials
       (stock_item_id, serial_number, status, installed_at_drop_number)
     VALUES
       ($1, $2, 'installed', 'PR9B-DR-001'),
       ($1, $3, 'available', NULL)
     ON CONFLICT (stock_item_id, serial_number) DO NOTHING`,
    [ITEM_ONT, SN_A, SN_B],
  );
});

beforeEach(async () => {
  // Reset both serials to their baseline state so each test starts clean.
  await pool.query(
    `UPDATE stock_serials
        SET status = 'installed',
            installed_at_drop_number = 'PR9B-DR-001',
            current_location_id = NULL,
            allocated_to_project_id = NULL,
            activated_at_olt_id = NULL,
            updated_at = NOW()
      WHERE serial_number = $1`,
    [SN_A],
  );
  await pool.query(
    `UPDATE stock_serials
        SET status = 'available',
            installed_at_drop_number = NULL,
            current_location_id = NULL,
            allocated_to_project_id = NULL,
            activated_at_olt_id = NULL,
            updated_at = NOW()
      WHERE serial_number = $1`,
    [SN_B],
  );
  // Remove any audit events written by previous tests.
  await pool.query(
    `DELETE FROM stock_serial_events
      WHERE serial_id IN (
        SELECT id FROM stock_serials WHERE serial_number LIKE 'PR9B-FC-%'
      )`,
  );
});

afterAll(async () => {
  try {
    await pool.query(
      `DELETE FROM stock_serial_events
        WHERE serial_id IN (
          SELECT id FROM stock_serials WHERE serial_number LIKE 'PR9B-FC-%'
        )`,
    );
    await pool.query(`DELETE FROM stock_serials WHERE serial_number LIKE 'PR9B-FC-%'`);
    await pool.query(`DELETE FROM stock_locations WHERE id = $1`, [WAREHOUSE_FC]);
    await pool.query(`DELETE FROM stock_items WHERE id = $1`, [ITEM_ONT]);
  } finally {
    await pool.end();
  }
});

// ============================================================================
// Helpers
// ============================================================================

function baseParams(overrides: Partial<Parameters<typeof forceCorrectSerials>[0]> = {}) {
  return {
    serials: [SN_A],
    target: { status: 'available' as const },
    reason: 'test reason',
    performedBy: TEST_USER_ID,
    performedByName: PERFORMED_BY_NAME,
    dryRun: false,
    ...overrides,
  };
}

async function getSerial(sn: string) {
  const { rows } = await pool.query<{
    status: string;
    installed_at_drop_number: string | null;
    current_location_id: string | null;
    allocated_to_project_id: string | null;
    activated_at_olt_id: string | null;
  }>(
    `SELECT status,
            installed_at_drop_number,
            current_location_id,
            allocated_to_project_id,
            activated_at_olt_id
       FROM stock_serials
      WHERE serial_number = $1`,
    [sn],
  );
  return rows[0] ?? null;
}

async function getAuditRows(sn: string) {
  const { rows } = await pool.query<{
    event_type: string;
    from_state: string | null;
    to_state: string | null;
    actor_user_id: string | null;
    payload: Record<string, unknown>;
  }>(
    `SELECT e.event_type, e.from_state, e.to_state,
            e.actor_user_id::text, e.payload
       FROM stock_serial_events e
       JOIN stock_serials s ON s.id = e.serial_id
      WHERE s.serial_number = $1
      ORDER BY e.occurred_at`,
    [sn],
  );
  return rows;
}

// ============================================================================
// Tests
// ============================================================================

describe('forceCorrectSerials', () => {
  // ─── 1. Happy path single serial ─────────────────────────────────────────
  it('applies status change on a single serial (installed → available)', async () => {
    const result = await forceCorrectSerials(baseParams({
      serials: [SN_A],
      target: { status: 'available' },
    }));

    expect(result.dryRun).toBe(false);
    expect(result.totalRequested).toBe(1);
    expect(result.totalApplied).toBe(1);
    expect(result.totalFailed).toBe(0);
    expect(result.totalNoOp).toBe(0);

    const row = result.rows[0];
    expect(row.serialNumber).toBe(SN_A);
    expect(row.found).toBe(true);
    expect(row.applied).toBe(true);
    expect(row.changedFields).toEqual(['status']);
    expect(row.before).toMatchObject({ status: 'installed' });
    expect(row.after).toMatchObject({ status: 'available' });
    expect(row.error).toBeUndefined();

    // DB row reflects the new state.
    const db = await getSerial(SN_A);
    expect(db?.status).toBe('available');
  });

  // ─── 2. Dry-run ──────────────────────────────────────────────────────────
  it('dry-run reports what would change without touching DB or writing audit', async () => {
    const result = await forceCorrectSerials(baseParams({
      serials: [SN_A],
      target: { status: 'available' },
      dryRun: true,
    }));

    expect(result.dryRun).toBe(true);
    expect(result.totalApplied).toBe(0);
    expect(result.totalFailed).toBe(0);

    const row = result.rows[0];
    expect(row.found).toBe(true);
    expect(row.applied).toBe(false);
    expect(row.changedFields).toEqual(['status']);
    expect(row.before).toMatchObject({ status: 'installed' });
    expect(row.after).toMatchObject({ status: 'available' });

    // DB unchanged.
    const db = await getSerial(SN_A);
    expect(db?.status).toBe('installed');

    // No audit row.
    const events = await getAuditRows(SN_A);
    expect(events).toHaveLength(0);
  });

  // ─── 3. No-op ────────────────────────────────────────────────────────────
  it('returns found=true, applied=false, empty changedFields when target equals current', async () => {
    // SN_A starts as 'installed' — pass the same state.
    const result = await forceCorrectSerials(baseParams({
      serials: [SN_A],
      target: { status: 'installed' },
    }));

    expect(result.totalApplied).toBe(0);
    expect(result.totalNoOp).toBe(1);
    expect(result.totalFailed).toBe(0);

    const row = result.rows[0];
    expect(row.found).toBe(true);
    expect(row.applied).toBe(false);
    expect(row.changedFields).toHaveLength(0);

    // No audit row.
    const events = await getAuditRows(SN_A);
    expect(events).toHaveLength(0);
  });

  // ─── 4. Not-found ────────────────────────────────────────────────────────
  it('marks not-found serial as found=false, applied=false — not a failure', async () => {
    const result = await forceCorrectSerials(baseParams({
      serials: ['PR9B-FC-NONEXISTENT'],
      target: { status: 'available' },
    }));

    expect(result.totalRequested).toBe(1);
    expect(result.totalApplied).toBe(0);
    expect(result.totalFailed).toBe(0);   // NOT a failure; it's simply not found
    expect(result.totalNoOp).toBe(0);

    const row = result.rows[0];
    expect(row.found).toBe(false);
    expect(row.applied).toBe(false);
    expect(row.changedFields).toHaveLength(0);
    expect(row.error).toBeUndefined();
  });

  // ─── 5. Multi-field + null clear ─────────────────────────────────────────
  it('applies status + installedAtDropNumber=null atomically; DB reflects both', async () => {
    // SN_A starts: status='installed', installed_at_drop_number='PR9B-DR-001'.
    const result = await forceCorrectSerials(baseParams({
      serials: [SN_A],
      target: { status: 'available', installedAtDropNumber: null },
    }));

    expect(result.totalApplied).toBe(1);

    const row = result.rows[0];
    expect(row.applied).toBe(true);
    expect(row.changedFields).toContain('status');
    expect(row.changedFields).toContain('installedAtDropNumber');
    expect(row.changedFields).toHaveLength(2);

    expect(row.before).toMatchObject({
      status: 'installed',
      installedAtDropNumber: 'PR9B-DR-001',
    });
    expect(row.after).toMatchObject({
      status: 'available',
      installedAtDropNumber: null,
    });

    // DB updated atomically.
    const db = await getSerial(SN_A);
    expect(db?.status).toBe('available');
    expect(db?.installed_at_drop_number).toBeNull();
  });

  // ─── 6. Audit row payload shape ───────────────────────────────────────────
  it('writes a correctly shaped audit row to stock_serial_events', async () => {
    await forceCorrectSerials(baseParams({
      serials: [SN_A],
      target: { status: 'available' },
      reason: 'audit-shape test',
      performedBy: TEST_USER_ID,
      performedByName: PERFORMED_BY_NAME,
    }));

    const events = await getAuditRows(SN_A);
    expect(events).toHaveLength(1);

    const evt = events[0];
    expect(evt.event_type).toBe('force_corrected');
    expect(evt.from_state).toBe('installed');   // status changed
    expect(evt.to_state).toBe('available');
    expect(evt.actor_user_id).toBe(TEST_USER_ID);

    expect(evt.payload).toMatchObject({
      isForceCorrect: true,
      reason: 'audit-shape test',
      performedByName: PERFORMED_BY_NAME,
      before: { status: 'installed' },
      after: { status: 'available' },
      changedFields: ['status'],
    });
  });

  // ─── 7. Batch best-effort ─────────────────────────────────────────────────
  it('processes batch of 3 serials: one applied, one no-op, one not-found, zero failed', async () => {
    // SN_A: installed → available (change → applied).
    // SN_B: already available → target available (no-op).
    // NONEXISTENT: not found.
    const result = await forceCorrectSerials(baseParams({
      serials: [SN_A, SN_B, 'PR9B-FC-NONEXISTENT'],
      target: { status: 'available' },
    }));

    expect(result.totalRequested).toBe(3);
    expect(result.totalApplied).toBe(1);
    expect(result.totalNoOp).toBe(1);
    expect(result.totalFailed).toBe(0);

    const rowA = result.rows.find(r => r.serialNumber === SN_A)!;
    expect(rowA.applied).toBe(true);
    expect(rowA.changedFields).toEqual(['status']);

    const rowB = result.rows.find(r => r.serialNumber === SN_B)!;
    expect(rowB.applied).toBe(false);
    expect(rowB.found).toBe(true);
    expect(rowB.changedFields).toHaveLength(0);

    const rowNone = result.rows.find(r => r.serialNumber === 'PR9B-FC-NONEXISTENT')!;
    expect(rowNone.found).toBe(false);
    expect(rowNone.applied).toBe(false);
  });

  // ─── 8. Per-serial transaction isolation ─────────────────────────────────
  it('writes exactly one audit event for SN_A (changed) and zero for SN_B (no-op)', async () => {
    // SN_A: installed → available. SN_B: already available (no-op).
    await forceCorrectSerials(baseParams({
      serials: [SN_A, SN_B],
      target: { status: 'available' },
    }));

    const eventsA = await getAuditRows(SN_A);
    const eventsB = await getAuditRows(SN_B);

    expect(eventsA).toHaveLength(1);
    expect(eventsA[0].event_type).toBe('force_corrected');

    expect(eventsB).toHaveLength(0);
  });
});
