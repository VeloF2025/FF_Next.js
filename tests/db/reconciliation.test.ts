/**
 * tests/db/reconciliation.test.ts
 *
 * Integration tests for the reconcile-serials.ts CLI.
 * Runs the CLI via execFileSync and asserts exit code + output.
 *
 * Test isolation: any drift introduced during tests is cleaned up in finally.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { Pool } from 'pg';

const URL       = process.env.DATABASE_URL_TEST!;
const ROOT      = path.join(process.cwd());
const CLI_PATH  = path.join(ROOT, 'scripts', 'reconcile-serials.ts');
const TSX       = path.join(ROOT, 'node_modules', '.bin', 'tsx');

function runCLI(): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(TSX, [CLI_PATH], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: URL },
    cwd: ROOT,
  });
  return {
    stdout:   result.stdout ?? '',
    stderr:   result.stderr ?? '',
    exitCode: result.status ?? 1,
  };
}

// ---------------------------------------------------------------------------
// Test 1: CLI exits 0 when there is no drift
// ---------------------------------------------------------------------------
describe('reconcile-serials CLI', () => {
  it('exits 0 and prints [OK ] when database is consistent', async () => {
    // The seed has 2 assets (ALCL12345003/GZU0000004) with no stock_serials rows.
    // Register them temporarily so assets_without_serial=0, then clean up after.
    //
    // Note on latest_event_matches_status (Tolerance 0): expected drift = 0 here
    // because the test DB has no stock_serial_events rows yet (no backfill or
    // trigger has fired during global-setup), so the check's join finds zero
    // serials with events and the COUNT(*) is 0 trivially.
    const pool = new Pool({ connectionString: URL });
    let stdout = '';
    let exitCode = 1;
    try {
      // Prod schema correction (PR-7): stock_items has no device_type column.
      // ONT/Gizzu items are identified by item_code ('FT-ONT', 'FT-GIZZU').
      await pool.query(`
        INSERT INTO stock_serials (stock_item_id, serial_number, status)
        VALUES (
          (SELECT id FROM stock_items WHERE item_code = 'FT-ONT' LIMIT 1),
          'ALCL12345003', 'available'
        ) ON CONFLICT DO NOTHING`);
      await pool.query(`
        INSERT INTO stock_serials (stock_item_id, serial_number, status)
        VALUES (
          (SELECT id FROM stock_items WHERE item_code = 'FT-GIZZU' LIMIT 1),
          'GZU0000004', 'available'
        ) ON CONFLICT DO NOTHING`);

      const result = runCLI();
      stdout   = result.stdout;
      exitCode = result.exitCode;
    } finally {
      // Remove the temporarily-inserted serials so backfill A tests still have work.
      await pool.query(`
        DELETE FROM stock_serials
        WHERE serial_number IN ('ALCL12345003', 'GZU0000004')`);
      await pool.end();
    }

    expect(exitCode).toBe(0);
    expect(stdout).toContain('[OK ]');
  });

  // -------------------------------------------------------------------------
  // Test 2: CLI exits 1 on drift (accountability counter artificially broken)
  // -------------------------------------------------------------------------
  it('exits 1 when accountability counter has drift', async () => {
    const pool = new Pool({ connectionString: URL });
    const contractorId = 'dddddddd-eeee-eeee-eeee-dddddddddddd';

    try {
      // Insert a done picking with contractor_id so derived count = 1.
      // Prod schema: stock_pickings needs picking_number/picking_type/source_location_id/
      // destination_location_id; technician_id (not staff_id).
      const { rows: [{ id: pickId }] } = await pool.query<{ id: string }>(`
        INSERT INTO stock_pickings
          (picking_number, picking_type, status,
           source_location_id, destination_location_id,
           technician_id, contractor_id, contractor_name, done_at)
        VALUES ('PICK-RECONCILE-' || substr(md5(random()::text), 1, 8),
                'issue', 'done',
                '10000000-0000-0000-0000-000000000001',
                '10000000-0000-0000-0000-000000000002',
                '33333333-3333-3333-3333-333333333333',
                $1, 'Test Contractor', NOW())
        RETURNING id`, [contractorId]);

      // Prod schema: stock_picking_lines uses serial_ids UUID[]; stock_item_id NOT NULL.
      await pool.query(`
        INSERT INTO stock_picking_lines
          (picking_id, stock_item_id, serial_ids, serial_number)
        VALUES ($1,
                '55555555-5555-5555-5555-555555555555',
                ARRAY['77777777-7777-7777-7777-777777777777'::uuid],
                'ALCL12345001')`, [pickId]);

      // Force the accountability counter to 999 — creates drift vs derived count (1).
      // contractor_name is NOT NULL in prod, must provide on INSERT.
      await pool.query(`
        INSERT INTO contractor_stock_accountability
          (contractor_id, contractor_name, total_issued_count, total_returned_count)
        VALUES ($1, 'Test Contractor', 999, 0)
        ON CONFLICT (contractor_id) DO UPDATE SET total_issued_count = 999`,
        [contractorId]);

      const { stdout, exitCode } = runCLI();

      expect(exitCode).toBe(1);
      expect(stdout).toContain('[FAIL]');
      expect(stdout).toContain('accountability_issued_counter_drift');
    } finally {
      await pool.query(`
        DELETE FROM stock_picking_lines spl
        USING  stock_pickings sp
        WHERE  spl.picking_id = sp.id
          AND  sp.contractor_id = $1`, [contractorId]);
      await pool.query(`
        DELETE FROM stock_pickings WHERE contractor_id = $1`, [contractorId]);
      await pool.query(`
        DELETE FROM contractor_stock_accountability WHERE contractor_id = $1`,
        [contractorId]);
      // Reset serial status that the cleanup picking may have disturbed.
      await pool.query(`
        UPDATE stock_serials
        SET    status = 'available', updated_at = NOW()
        WHERE  id = '77777777-7777-7777-7777-777777777777'`);
      await pool.end();
    }
  });
});

// Satisfy import-side-effect lint rules
void execFileSync;
