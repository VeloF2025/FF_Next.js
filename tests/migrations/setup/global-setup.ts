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

/**
 * Unique per invocation. Containers are labelled with it so a run only ever
 * removes its OWN container — a blanket sweep by the shared label would let a
 * CI run destroy a developer's container mid-test on this shared machine, or
 * vice versa. (Only one runner serves this repo today, so CI jobs serialise,
 * but a local `npm run test:migrations` overlapping a CI run is entirely
 * possible, and a second runner would make CI-vs-CI possible too.)
 */
const RUN_ID = process.env.GITHUB_RUN_ID
  ? `ci-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`
  : `local-${process.pid}`;

let containerId = '';

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

async function waitForReady(url: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    let pool: Pool | undefined;
    try {
      pool = new Pool({ connectionString: url, connectionTimeoutMillis: 1000 });
      await pool.query('SELECT 1');
      await pool.end();
      return;
    } catch (e) {
      lastErr = e;
      // Close the failed pool before retrying; otherwise a slow start leaves
      // ~120 short-lived pools for GC to deal with.
      try {
        await pool?.end();
      } catch {
        // Already unusable — nothing to release.
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`migration test DB not ready after ${timeoutMs}ms: ${String(lastErr)}`);
}

export async function setup() {
  // Two sweeps, both safe under concurrency:
  //   1. Our own run's leftovers (e.g. a re-run of the same CI attempt).
  //   2. Any EXITED container from any run. A stopped container is by
  //      construction not in use by a live sibling, so this cannot resurrect
  //      the bug that a blanket label sweep caused — while still reaping
  //      orphans left by a hard kill (SIGKILL/OOM/reboot), which this host has
  //      a history of accumulating.
  // Deliberately NOT a blanket sweep of running containers — see RUN_ID above.
  const stale = [
    ...docker(['ps', '-aq', '--filter', `label=ff-migration-run=${RUN_ID}`]).split('\n'),
    ...docker(['ps', '-aq', '--filter', `label=${LABEL}`, '--filter', 'status=exited']).split('\n'),
  ].filter(Boolean);
  for (const id of stale) {
    try {
      docker(['rm', '-f', id]);
    } catch {
      // Already gone — nothing to clean up.
    }
  }

  containerId = docker([
    'run', '-d', '--label', LABEL, '--label', `ff-migration-run=${RUN_ID}`,
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
    // Best effort. A hard-killed process (SIGKILL, reboot) can still orphan one
    // container; it is harmless because the port is ephemeral so it blocks
    // nothing, and `docker rm -f $(docker ps -aq --filter label=ff-migration-tests)`
    // clears any accumulation when no run is active.
  }
}
