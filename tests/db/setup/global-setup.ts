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
  // Up without --wait (works on Compose v1 + v2.x without v2.20+). Readiness
  // is polled in TS via waitForReady() so we don't race Postgres startup.
  // Using `docker-compose` (standalone) because the `docker compose` plugin
  // is not registered on this machine; standalone v2.32.0 is installed.
  execFileSync('docker-compose', ['-f', COMPOSE, 'up', '-d'],
    { stdio: 'inherit' });
  await waitForReady();

  const seed = await fs.readFile(path.join(process.cwd(),
    'tests/db/setup/seed.sql'), 'utf8');
  const migration = await fs.readFile(path.join(process.cwd(),
    'scripts/migrations/sql/362_serial_master_register.sql'), 'utf8');
  const triggers = await fs.readFile(path.join(process.cwd(),
    'scripts/migrations/sql/364_serial_event_triggers.sql'), 'utf8');
  // Migration 365 (PR-7): fixes Trigger 2 + Trigger 3 against actual prod schema.
  //   Trigger 2 (qa_photo_reviews): ont_serial_scanned + drop_number-to-id lookup.
  //   Trigger 3 (oes_pp_data): olt_pon, created_at, md5-uuid for source_id.
  const triggerFix = await fs.readFile(path.join(process.cwd(),
    'scripts/migrations/sql/365_fix_qa_oes_triggers.sql'), 'utf8');
  // Migration 366 (PR-8): fixes Trigger 1 (picking_done) against actual prod
  // schema — replaces done_at (which doesn't exist) with COALESCE(signed_at,
  // effective_date, approved_at, NOW()).
  const triggerFix2 = await fs.readFile(path.join(process.cwd(),
    'scripts/migrations/sql/366_fix_picking_trigger_done_at.sql'), 'utf8');
  // Migration 367 (HOTFIX — PR-7 blind review): drops AFTER UPDATE OF ont_serial
  //   trigger. Trigger 2 fires on qa_photo_reviews.ont_serial_scanned which is
  //   NULL in all prod rows; this trigger fires on the canonical install column.
  const dropsTrigger = await fs.readFile(path.join(process.cwd(),
    'scripts/migrations/sql/367_drops_install_trigger.sql'), 'utf8');
  const pool = new Pool({ connectionString: URL });
  await pool.query(seed);
  await pool.query(migration);
  await pool.query(triggers);
  await pool.query(triggerFix);
  await pool.query(triggerFix2);
  await pool.query(dropsTrigger);
  await pool.end();
  process.env.DATABASE_URL_TEST = URL;
}

export async function teardown() {
  execFileSync('docker-compose', ['-f', COMPOSE, 'down', '-v'],
    { stdio: 'inherit' });
}
