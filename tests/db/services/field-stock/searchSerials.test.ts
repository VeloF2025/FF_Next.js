/**
 * tests/db/services/field-stock/searchSerials.test.ts
 *
 * Integration tests for searchSerials(). Runs against the Wave-1 docker-compose
 * test harness (boot via: docker-compose -f tests/db/setup/docker-compose.test.yml up -d).
 *
 * Convention deviation from the operative plan (PR #1720):
 *   Plan suggested `src/services/...__tests__/searchSerials.test.ts` with
 *   `TRUNCATE ... RESTART IDENTITY CASCADE`. That breaks the shared seed
 *   used by tests/db/triggers/* (they read fixed seed UUIDs like SERIAL_ID_1).
 *   This file follows the existing tests/db/ pattern: INSERT-only with
 *   PR8-prefixed UUIDs/serial-numbers, targeted DELETE in afterAll, every
 *   assertion scoped to test-only rows via q:'PR8-' or projectId filter.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { searchSerials } from '@/modules/procurement/field-stock/services/serialSearchService';

const TEST_DB_URL = process.env.DATABASE_URL_TEST;
if (!TEST_DB_URL) {
  throw new Error(
    'DATABASE_URL_TEST not set — boot tests/db/setup/docker-compose.test.yml or run via `npm run test:db`.'
  );
}

// Distinct UUID range so we never touch seed rows. Prefix "aaaa…001" so far
// from any seed UUID that cleanup is a precise targeted DELETE.
const ITEM_ONT    = 'aaaaaaaa-0000-0000-0000-000000000001';
const ITEM_GIZZU  = 'aaaaaaaa-0000-0000-0000-000000000002';
const WAREHOUSE   = 'aaaaaaaa-0000-0000-0000-000000000003';
const PROJECT_PR8 = 'aaaaaaaa-0000-0000-0000-000000000004';

const pool = new Pool({ connectionString: TEST_DB_URL });

beforeAll(async () => {
  await pool.query(
    `INSERT INTO stock_items (id, item_code, name, category, tracking_type) VALUES
       ($1, 'PR8-ONT',   'PR8 Test ONT',   'ONT',   'serial'),
       ($2, 'PR8-GIZZU', 'PR8 Test Gizzu', 'GIZZU', 'serial')
     ON CONFLICT (id) DO NOTHING`,
    [ITEM_ONT, ITEM_GIZZU]
  );
  await pool.query(
    `INSERT INTO stock_locations (id, code, name, location_type)
     VALUES ($1, 'PR8-WH', 'PR8 Warehouse', 'warehouse')
     ON CONFLICT (id) DO NOTHING`,
    [WAREHOUSE]
  );
  await pool.query(
    `INSERT INTO projects (id, project_name) VALUES ($1, 'PR8 Test Project')
     ON CONFLICT (id) DO NOTHING`,
    [PROJECT_PR8]
  );
  // 10 test serials:
  //   5 status-positive (status filter ['available','installed'] matches 4 of them; ACT excluded):
  //     SN-AVAIL-01 (warehouse, no project),
  //     SN-AVAIL-02 (warehouse, project),
  //     SN-INST-01  (no location, project, installed_at_drop_number='PR8-DR-0001'),
  //     SN-ACT-01   (no location, project, activated — excluded by status filter)
  //     SN-GIZZU-01 (warehouse, no project, category GIZZU)
  //   4 status-negative (excluded by status filter):
  //     SN-ISSUED-01, SN-FAULTY-01, SN-RETURNED-01, SN-SCRAPPED-01
  //   3 project-allocated rows (SN-AVAIL-02, SN-INST-01, SN-ACT-01).
  //   1 serial gets a stock_serial_events row (SN-INST-01) to exercise the
  //   LATERAL latest-event join + the Date→ISO serialization branch.
  await pool.query(
    `INSERT INTO stock_serials
      (id, stock_item_id, serial_number, mac_address, status,
       current_location_id, allocated_to_project_id, installed_at_drop_number)
     VALUES
      (gen_random_uuid(), $1, 'PR8-SN-AVAIL-01',    'BB:BB:CC:00:00:01', 'available', $3, NULL, NULL),
      (gen_random_uuid(), $1, 'PR8-SN-AVAIL-02',    NULL,                'available', $3, $4,   NULL),
      (gen_random_uuid(), $1, 'PR8-SN-INST-01',     'BB:BB:CC:00:00:02', 'installed', NULL, $4, 'PR8-DR-0001'),
      (gen_random_uuid(), $1, 'PR8-SN-ACT-01',      'BB:BB:CC:00:00:03', 'activated', NULL, $4, NULL),
      (gen_random_uuid(), $2, 'PR8-SN-GIZZU-01',    NULL,                'available', $3, NULL, NULL),
      (gen_random_uuid(), $1, 'PR8-SN-ISSUED-01',   'BB:BB:CC:00:00:04', 'issued',    NULL, NULL, NULL),
      (gen_random_uuid(), $1, 'PR8-SN-FAULTY-01',   NULL,                'faulty',    NULL, NULL, NULL),
      (gen_random_uuid(), $1, 'PR8-SN-RETURNED-01', NULL,                'returned',  NULL, NULL, NULL),
      (gen_random_uuid(), $1, 'PR8-SN-SCRAPPED-01', NULL,                'scrapped',  NULL, NULL, NULL)`,
    [ITEM_ONT, ITEM_GIZZU, WAREHOUSE, PROJECT_PR8]
  );
  // One event row for SN-INST-01 to exercise the LATERAL join.
  await pool.query(
    `INSERT INTO stock_serial_events
      (id, serial_id, event_type, to_state, occurred_at)
     SELECT gen_random_uuid(), id, 'installed_at_drop', 'installed', '2026-05-20T10:30:00Z'
     FROM stock_serials WHERE serial_number = 'PR8-SN-INST-01'`
  );
});

afterAll(async () => {
  // Targeted cleanup — must run even if an earlier DELETE throws so that
  // pool.end() executes and subsequent test files don't hang on a stuck pool.
  try {
    await pool.query(`DELETE FROM stock_serial_events WHERE serial_id IN (SELECT id FROM stock_serials WHERE serial_number LIKE 'PR8-%')`);
    await pool.query(`DELETE FROM stock_serials WHERE serial_number LIKE 'PR8-%'`);
    await pool.query(`DELETE FROM projects WHERE id = $1`, [PROJECT_PR8]);
    await pool.query(`DELETE FROM stock_locations WHERE id = $1`, [WAREHOUSE]);
    await pool.query(`DELETE FROM stock_items WHERE id = ANY($1::uuid[])`, [[ITEM_ONT, ITEM_GIZZU]]);
  } finally {
    await pool.end();
  }
});

describe('searchSerials', () => {
  it('returns 9 PR8 rows when scoped via q:"PR8-"', async () => {
    const result = await searchSerials({ q: 'PR8-' }, { page: 1, pageSize: 50 });
    expect(result.total).toBe(9);
    expect(result.rows).toHaveLength(9);
    expect(result.rows.every((r) => r.serialNumber.startsWith('PR8-'))).toBe(true);
  });

  it('filters by free-text on serial_number (prefix)', async () => {
    const result = await searchSerials({ q: 'PR8-SN-AVAIL' }, { page: 1, pageSize: 50 });
    expect(result.total).toBe(2);
    const names = result.rows.map((r) => r.serialNumber).sort();
    expect(names).toEqual(['PR8-SN-AVAIL-01', 'PR8-SN-AVAIL-02']);
    // L6 — q:'PR8-SN-AVAIL' must return BOTH rows even though SN-AVAIL-02
    // has mac_address=NULL. Guards against OR→AND drift on the ILIKE clause.
    const macs = result.rows.map((r) => r.macAddress).sort((a, b) => String(a).localeCompare(String(b)));
    expect(macs).toContain(null);
    expect(macs).toContain('BB:BB:CC:00:00:01');
  });

  it('filters by mac_address (prefix)', async () => {
    const result = await searchSerials({ q: 'BB:BB:CC:00:00:01' }, { page: 1, pageSize: 50 });
    expect(result.total).toBe(1);
    expect(result.rows[0].serialNumber).toBe('PR8-SN-AVAIL-01');
    expect(result.rows[0].macAddress).toBe('BB:BB:CC:00:00:01');
  });

  it('escapes LIKE wildcards in q — q:"%" must NOT match every row', async () => {
    // No PR8 row has '%' or '_' literally in its serial/mac; this asserts the
    // ESCAPE clause is applied and prevents wildcard injection / unbounded scan.
    const result = await searchSerials({ q: '%' }, { page: 1, pageSize: 50 });
    const pr8Hits = result.rows.filter((r) => r.serialNumber.startsWith('PR8-'));
    expect(pr8Hits).toHaveLength(0);
  });

  it('filters by status multi-select scoped to PR8 rows', async () => {
    const result = await searchSerials(
      { q: 'PR8-', status: ['available', 'installed'] },
      { page: 1, pageSize: 50 }
    );
    const got = result.rows.map((r) => r.serialNumber).sort();
    expect(got).toEqual([
      'PR8-SN-AVAIL-01',
      'PR8-SN-AVAIL-02',
      'PR8-SN-GIZZU-01',
      'PR8-SN-INST-01',
    ]);
  });

  it('filters by category GIZZU scoped to PR8 rows', async () => {
    const result = await searchSerials({ q: 'PR8-', category: 'GIZZU' }, { page: 1, pageSize: 50 });
    expect(result.total).toBe(1);
    expect(result.rows[0].serialNumber).toBe('PR8-SN-GIZZU-01');
    expect(result.rows[0].category).toBe('GIZZU');
    expect(result.rows[0].itemName).toBe('PR8 Test Gizzu');
  });

  it('filters by projectId returns 3 allocated PR8 rows', async () => {
    const result = await searchSerials({ q: 'PR8-', projectId: PROJECT_PR8 }, { page: 1, pageSize: 50 });
    expect(result.total).toBe(3);
    expect(result.rows.every((r) => r.allocatedProjectName === 'PR8 Test Project')).toBe(true);
    expect(result.rows.map((r) => r.serialNumber).sort()).toEqual([
      'PR8-SN-ACT-01',
      'PR8-SN-AVAIL-02',
      'PR8-SN-INST-01',
    ]);
  });

  it('filters by warehouseId returns rows whose current_location_id matches', async () => {
    const result = await searchSerials({ q: 'PR8-', warehouseId: WAREHOUSE }, { page: 1, pageSize: 50 });
    expect(result.total).toBe(3);
    expect(result.rows.every((r) => r.currentLocationName === 'PR8 Warehouse')).toBe(true);
  });

  it('filters by dropNumber returns only the matching installed serial', async () => {
    const result = await searchSerials(
      { q: 'PR8-', dropNumber: 'PR8-DR-0001' },
      { page: 1, pageSize: 50 }
    );
    expect(result.total).toBe(1);
    expect(result.rows[0].serialNumber).toBe('PR8-SN-INST-01');
    expect(result.rows[0].installedAtDropNumber).toBe('PR8-DR-0001');
  });

  it('returns lastEventType + lastEventAt (ISO string) for serials with events', async () => {
    const result = await searchSerials(
      { q: 'PR8-SN-INST-01' },
      { page: 1, pageSize: 50 }
    );
    expect(result.total).toBe(1);
    const row = result.rows[0];
    expect(row.lastEventType).toBe('installed_at_drop');
    // pg returns TIMESTAMPTZ as Date; service must serialize to ISO string.
    expect(typeof row.lastEventAt).toBe('string');
    expect(row.lastEventAt).toMatch(/^2026-05-20T10:30:00/);
  });

  it('returns null lastEvent fields for serials with no events', async () => {
    const result = await searchSerials(
      { q: 'PR8-SN-AVAIL-01' },
      { page: 1, pageSize: 50 }
    );
    expect(result.total).toBe(1);
    expect(result.rows[0].lastEventType).toBeNull();
    expect(result.rows[0].lastEventAt).toBeNull();
  });

  it('paginates correctly (5 + 4 split)', async () => {
    const p1 = await searchSerials({ q: 'PR8-' }, { page: 1, pageSize: 5 });
    const p2 = await searchSerials({ q: 'PR8-' }, { page: 2, pageSize: 5 });
    expect(p1.total).toBe(9);
    expect(p1.rows).toHaveLength(5);
    expect(p2.rows).toHaveLength(4);
    const p1Ids = p1.rows.map((r) => r.id);
    const p2Ids = p2.rows.map((r) => r.id);
    expect(p1Ids.some((id) => p2Ids.includes(id))).toBe(false);
  });

  it('clamps pageSize to max 200', async () => {
    const result = await searchSerials({ q: 'PR8-' }, { page: 1, pageSize: 99999 });
    expect(result.pageSize).toBe(200);
  });

  it('clamps pageSize to minimum 1 when 0 is passed', async () => {
    const result = await searchSerials({ q: 'PR8-' }, { page: 1, pageSize: 0 });
    expect(result.pageSize).toBe(1);
  });

  it('clamps page to minimum 1', async () => {
    const result = await searchSerials({ q: 'PR8-' }, { page: 0, pageSize: 5 });
    expect(result.page).toBe(1);
  });

  it('returns empty result with total=0 when no rows match', async () => {
    const result = await searchSerials({ q: 'PR8-NONEXISTENT-' }, { page: 1, pageSize: 50 });
    expect(result.total).toBe(0);
    expect(result.rows).toHaveLength(0);
  });
});
