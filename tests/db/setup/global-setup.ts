import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { Pool } from 'pg';

/**
 * An EPHEMERAL port, not the fixed 55432 this used to publish.
 *
 * 55432 is not ours to take: on velo — which is both a developer machine and
 * the self-hosted CI runner — an unrelated project's `outreach-pipeline-db-1`
 * holds it permanently, so `docker-compose up` fails with "port is already
 * allocated" and the whole suite dies in global setup before a single test
 * runs. Publishing on `127.0.0.1::5432` lets Docker choose a free port, which
 * is read back with `docker port`; two runs can then never collide either.
 *
 * Mirrors tests/db/velocity-review/global-setup.ts, which already had to solve
 * this to run on the same runner.
 */
const CONTAINER = `ff-db-tests-${process.pid}`;
const DATABASE = 'fibreflow_test';
const USER = 'fibreflow_test';
const PASSWORD = randomBytes(18).toString('hex');

/**
 * Run-scoped, so the CI cleanup step can sweep a container orphaned by a
 * killed run without reaping a concurrent run's container.
 */
const RUN_ID = process.env.GITHUB_RUN_ID
  ? `ci-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`
  : `local-${process.pid}`;

let URL = '';
let started = false;

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
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`test DB not ready after ${timeoutMs}ms: ${String(lastErr)}`);
}

export async function setup() {
  // `docker run` rather than compose: compose pins the published port in the
  // YAML, which is the thing that has to vary. Readiness is polled in TS via
  // waitForReady() so we never race Postgres startup.
  execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '-d',
      '--name',
      CONTAINER,
      '--label',
      'ff-db-tests',
      '--label',
      `ff-db-tests-run=${RUN_ID}`,
      '-e',
      `POSTGRES_USER=${USER}`,
      '-e',
      `POSTGRES_PASSWORD=${PASSWORD}`,
      '-e',
      `POSTGRES_DB=${DATABASE}`,
      '-p',
      '127.0.0.1::5432',
      // tmpfs keeps the data directory in RAM, as the compose file did.
      '--tmpfs',
      '/var/lib/postgresql/data',
      'postgres:15-alpine',
    ],
    { stdio: 'ignore' }
  );
  started = true;

  const binding = execFileSync('docker', ['port', CONTAINER, '5432/tcp'], {
    encoding: 'utf8',
  }).trim();
  const port = binding.slice(binding.lastIndexOf(':') + 1);
  URL = `postgres://${USER}:${PASSWORD}@127.0.0.1:${port}/${DATABASE}`;
  await waitForReady();

  const seed = await fs.readFile(path.join(process.cwd(), 'tests/db/setup/seed.sql'), 'utf8');
  const zoneDeliverySeed = await fs.readFile(
    path.join(process.cwd(), 'tests/db/setup/zone-delivery-seed.sql'),
    'utf8'
  );
  const migration = await fs.readFile(
    path.join(process.cwd(), 'scripts/migrations/sql/362_serial_master_register.sql'),
    'utf8'
  );
  const triggers = await fs.readFile(
    path.join(process.cwd(), 'scripts/migrations/sql/364_serial_event_triggers.sql'),
    'utf8'
  );
  // Migration 365 (PR-7): fixes Trigger 2 + Trigger 3 against actual prod schema.
  //   Trigger 2 (qa_photo_reviews): ont_serial_scanned + drop_number-to-id lookup.
  //   Trigger 3 (oes_pp_data): olt_pon, created_at, md5-uuid for source_id.
  const triggerFix = await fs.readFile(
    path.join(process.cwd(), 'scripts/migrations/sql/365_fix_qa_oes_triggers.sql'),
    'utf8'
  );
  // Migration 366 (PR-8): fixes Trigger 1 (picking_done) against actual prod
  // schema — replaces done_at (which doesn't exist) with COALESCE(signed_at,
  // effective_date, approved_at, NOW()).
  const triggerFix2 = await fs.readFile(
    path.join(process.cwd(), 'scripts/migrations/sql/366_fix_picking_trigger_done_at.sql'),
    'utf8'
  );
  // Migration 367 (HOTFIX — PR-7 blind review): drops AFTER UPDATE OF ont_serial
  //   trigger. Trigger 2 fires on qa_photo_reviews.ont_serial_scanned which is
  //   NULL in all prod rows; this trigger fires on the canonical install column.
  const dropsTrigger = await fs.readFile(
    path.join(process.cwd(), 'scripts/migrations/sql/367_drops_install_trigger.sql'),
    'utf8'
  );
  const zoneDeliveryMigration = await fs.readFile(
    path.join(process.cwd(), 'scripts/migrations/sql/470_zone_delivery_handover.sql'),
    'utf8'
  );
  // 485 narrows 470's handover immutability to "unless the correction GUC is
  // set". This list is hand-maintained: a migration missing here is invisible
  // to the docker suite, so the trigger it changes stays at its old behaviour
  // and the tests covering the change pass for the wrong reason.
  const zoneHandoverCorrection = await fs.readFile(
    path.join(process.cwd(), 'scripts/migrations/sql/485_zone_delivery_handover_correction.sql'),
    'utf8'
  );
  const pool = new Pool({ connectionString: URL });
  await pool.query(seed);
  await pool.query(zoneDeliverySeed);
  await pool.query(migration);
  await pool.query(triggers);
  await pool.query(triggerFix);
  await pool.query(triggerFix2);
  await pool.query(dropsTrigger);
  await pool.query(zoneDeliveryMigration);
  await pool.query(zoneHandoverCorrection);
  await pool.end();
  process.env.DATABASE_URL_TEST = URL;
  // Service-layer integration tests (tests/db/services/*) call into the
  // shared @/lib/db pool which reads DATABASE_URL at module-load. Point it
  // at the test container so those services hit the right DB. Existing
  // tests/db/triggers/* + tests/db/backfill/* construct their own pg.Pool
  // from DATABASE_URL_TEST and are unaffected.
  //
  // Race caveat: vitest's globalSetup runs once before workers spawn, and
  // workers inherit `process.env` snapshotted at fork time — so any test
  // module loaded by a worker will see this DATABASE_URL value. The risk
  // is that another vitest invocation running in the SAME process (not the
  // standard CLI flow, but possible under watch mode or library embedding)
  // could observe DATABASE_URL changing mid-run. Documented for awareness;
  // not an issue under `npm run test:db` which uses a fresh process.
  process.env.DATABASE_URL = URL;
}

export async function teardown() {
  if (!started) return;
  // --rm on the container means stopping it also removes it and its tmpfs.
  spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
  started = false;
}
