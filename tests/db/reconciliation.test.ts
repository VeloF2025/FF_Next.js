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
  // Test 2: CLI exits 1 on drift.
  // The former accountability_*_counter_drift checks were removed when
  // contractor_stock_accountability was dropped (Sprint E Track 4.5, mig 392),
  // so this exercises the surviving tolerance-0 check latest_event_matches_status:
  // a serial whose status disagrees with the to_state of its most-recent event.
  // -------------------------------------------------------------------------
  it('exits 1 when a serial status disagrees with its latest event', async () => {
    const pool = new Pool({ connectionString: URL });
    const serialNumber = 'ALCL-RECON-DRIFT-1';

    try {
      // A serial sitting in 'available'...
      const { rows: [{ id: serialId }] } = await pool.query<{ id: string }>(`
        INSERT INTO stock_serials (stock_item_id, serial_number, status)
        VALUES ((SELECT id FROM stock_items WHERE item_code = 'FT-ONT' LIMIT 1),
                $1, 'available')
        RETURNING id`, [serialNumber]);

      // ...whose most-recent event says 'installed' → latest_event_matches_status
      // drift (tolerance 0). source_table is a test-only tag for clean teardown.
      await pool.query(`
        INSERT INTO stock_serial_events
          (serial_id, event_type, from_state, to_state,
           source_table, source_id, occurred_at)
        VALUES ($1, 'installed', 'available', 'installed',
                'test_reconcile', gen_random_uuid(), NOW())`, [serialId]);

      const { stdout, exitCode } = runCLI();

      expect(exitCode).toBe(1);
      expect(stdout).toContain('[FAIL]');
      expect(stdout).toContain('latest_event_matches_status');
    } finally {
      // Delete events before the serial (events reference serial_id).
      await pool.query(`
        DELETE FROM stock_serial_events WHERE source_table = 'test_reconcile'`);
      await pool.query(`
        DELETE FROM stock_serials WHERE serial_number = $1`, [serialNumber]);
      await pool.end();
    }
  });
});

// Satisfy import-side-effect lint rules
void execFileSync;
