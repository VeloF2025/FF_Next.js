/**
 * tests/db/setup/sprint-e-global-setup.ts
 *
 * Vitest globalSetup for Sprint E lifecycle tests (tests/db/sprint-e/**).
 * Extends the base setup with migrations 383/384/387 and their prerequisites.
 *
 * Isolation rationale: mig 387 installs validate triggers that reject any raw
 * UPDATE stock_serials SET status = ... not routed through promoteSerial. The
 * existing tests/db/** tests do exactly those raw updates in beforeEach/setup
 * helpers. Loading mig 387 into the shared global-setup would break them all.
 * This separate setup + config (vitest.db.sprinte.config.ts) runs only the
 * Sprint E test files against a fresh Docker container that includes mig 387.
 *
 * Container: uses the same docker-compose.test.yml; the test DB is ephemeral
 * (--rm + docker-compose down -v on teardown) so there is no shared-state risk.
 */
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { Pool } from 'pg';

const COMPOSE = 'tests/db/setup/docker-compose.test.yml';
const URL = 'postgres://fibreflow_test:fibreflow_test@localhost:55432/fibreflow_test';

async function waitForReady(timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const pool = new Pool({ connectionString: URL, connectionTimeoutMillis: 1000 });
      await pool.query('SELECT 1');
      await pool.end();
      return;
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error(`test DB not ready after ${timeoutMs}ms: ${String(lastErr)}`);
}

export async function setup() {
  execFileSync('docker-compose', ['-f', COMPOSE, 'up', '-d'],
    { stdio: 'inherit' });
  await waitForReady();

  const readFile = (rel: string) =>
    fs.readFile(path.join(process.cwd(), rel), 'utf8');

  // Base schema (mirrors base global-setup)
  const seed      = await readFile('tests/db/setup/seed.sql');
  const mig362    = await readFile('scripts/migrations/sql/362_serial_master_register.sql');
  const mig364    = await readFile('scripts/migrations/sql/364_serial_event_triggers.sql');
  const mig365    = await readFile('scripts/migrations/sql/365_fix_qa_oes_triggers.sql');
  const mig366    = await readFile('scripts/migrations/sql/366_fix_picking_trigger_done_at.sql');
  const mig367    = await readFile('scripts/migrations/sql/367_drops_install_trigger.sql');

  // Sprint E prerequisites
  const sprintESeed       = await readFile('tests/db/setup/sprint-e-seed.sql');
  const mig383            = await readFile('scripts/migrations/sql/383_stock_holders.sql');
  const sprintEHoldersSeed = await readFile('tests/db/setup/sprint-e-holders-seed.sql');
  const mig384            = await readFile('scripts/migrations/sql/384_pure_custody_model.sql');
  const mig387            = await readFile('scripts/migrations/sql/387_serial_lifecycle_state_machine.sql');

  const pool = new Pool({ connectionString: URL });

  // Base schema
  await pool.query(seed);
  await pool.query(mig362);
  await pool.query(mig364);
  await pool.query(mig365);
  await pool.query(mig366);
  await pool.query(mig367);

  // Sprint C/D prerequisites: missing tables + migrations
  await pool.query(sprintESeed);    // contractors, field_stock_movements, stock_consumptions
  await pool.query(mig383);         // stock_holders table
  await pool.query(sprintEHoldersSeed); // seed staff holder row
  await pool.query(mig384);         // holder_id column on stock_serials + custody views

  // Sprint E cutover gate (intentional: the test harness IS the controlled
  // environment; ephemeral Docker container, not the shared prod DB).
  await pool.query('CREATE TABLE IF NOT EXISTS __sprint_e_cutover_gate__ ();');
  await pool.query(mig387);         // lifecycle validate + emit + holder triggers

  await pool.end();

  // Environment wiring — same convention as base global-setup.ts
  process.env.DATABASE_URL_TEST = URL;
  process.env.DATABASE_URL      = URL;
}

export async function teardown() {
  execFileSync('docker-compose', ['-f', COMPOSE, 'down', '-v'],
    { stdio: 'inherit' });
}
