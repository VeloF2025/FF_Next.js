/**
 * Global setup for the migration execution tests.
 *
 * Starts a throwaway Postgres, seeds it with the same schema tests/db/** uses,
 * exports TEST_DATABASE_URL, and removes the container afterwards.
 *
 * Why not reuse tests/db/setup/global-setup.ts: that harness hard-codes host
 * port 55432, and on a shared machine that port is not reliably free — it was
 * already owned by an unrelated project's container when this was written,
 * which makes `npm run test:db` fail there with a confusing "password
 * authentication failed" (the wrong Postgres answers). We ask Docker for an
 * ephemeral port instead and discover it, so this cannot collide with anything
 * else on the host or with a second CI job.
 *
 * Why TEST_DATABASE_URL specifically: tests/migrations/** read that variable
 * and THROW at module load if it is unset — they build a pg.Pool at module
 * scope, so they cannot skip gracefully. Vitest runs globalSetup once before
 * workers fork and workers inherit the env snapshot, so setting it here
 * reaches every test module.
 */

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { Pool } from 'pg';

const IMAGE = 'postgres:15-alpine'; // matches the live server's major (15.8)
const USER = 'fibreflow_test';
const DB = 'fibreflow_test';
const LABEL = 'ff-migration-tests';

let containerId = '';

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

async function waitForReady(url: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 1000 });
      await pool.query('SELECT 1');
      await pool.end();
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`migration test DB not ready after ${timeoutMs}ms: ${String(lastErr)}`);
}

export async function setup() {
  // Any container left behind by a killed run would hold a stale password.
  // Remove by label rather than by name so a crashed run cannot wedge the next.
  const stale = docker(['ps', '-aq', '--filter', `label=${LABEL}`]).split('\n').filter(Boolean);
  for (const id of stale) {
    try {
      docker(['rm', '-f', id]);
    } catch {
      // Already gone — nothing to clean up.
    }
  }

  containerId = docker([
    'run', '-d', '--label', LABEL,
    '-e', `POSTGRES_USER=${USER}`,
    '-e', `POSTGRES_PASSWORD=${USER}`,
    '-e', `POSTGRES_DB=${DB}`,
    // Port 0 = let the kernel pick a free one; discovered below.
    '-p', '127.0.0.1::5432',
    // Data is disposable; tmpfs keeps it off disk and makes startup faster.
    '--tmpfs', '/var/lib/postgresql/data',
    IMAGE,
  ]);

  // "127.0.0.1:49153" -> 49153
  const mapped = docker(['port', containerId, '5432/tcp']).split('\n')[0] ?? '';
  const hostPort = mapped.split(':').pop();
  if (!hostPort) {
    throw new Error(`could not determine mapped port for container ${containerId}`);
  }

  const url = `postgres://${USER}:${USER}@127.0.0.1:${hostPort}/${DB}`;
  await waitForReady(url);

  // Same seeds tests/db/** uses, in the same order. Both are needed: the base
  // seed has projects/migrations, and the zone-delivery seed is where
  // access_permissions and role_permissions actually live (378 reads those).
  // 471 builds its own scratch schema and needs neither.
  const pool = new Pool({ connectionString: url });
  for (const file of ['tests/db/setup/seed.sql', 'tests/db/setup/zone-delivery-seed.sql']) {
    await pool.query(await readFile(path.join(process.cwd(), file), 'utf8'));
  }
  await pool.end();

  process.env.TEST_DATABASE_URL = url;
}

export async function teardown() {
  if (!containerId) return;
  try {
    docker(['rm', '-f', containerId]);
  } catch {
    // Best effort — a manual `docker rm -f` is the fallback, and the next run
    // clears stragglers by label anyway.
  }
}
