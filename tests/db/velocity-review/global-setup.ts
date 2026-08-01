import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';

const CONTAINER = `ff-velocity-review-test-${process.pid}`;
const DATABASE = 'velocity_review_test';
const USER = 'velocity_review_test';
const PASSWORD = randomBytes(18).toString('hex');
const SCHEMA = 'velocity_review_task4';

let started = false;

function removeContainer(): void {
  if (!started) return;
  spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
  started = false;
}

async function waitForReady(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 1_000 });
    try {
      await pool.query('SELECT 1');
      await pool.end();
      return;
    } catch (error) {
      lastError = error;
      await pool.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Velocity review test database was not ready: ${String(lastError)}`);
}

export async function setup(): Promise<void> {
  try {
    execFileSync('docker', [
      'run', '--rm', '-d', '--name', CONTAINER,
      '-e', `POSTGRES_USER=${USER}`,
      '-e', `POSTGRES_PASSWORD=${PASSWORD}`,
      '-e', `POSTGRES_DB=${DATABASE}`,
      '-p', '127.0.0.1::5432',
      'postgres:16-alpine',
    ], { stdio: 'ignore' });
    started = true;

    const binding = execFileSync('docker', ['port', CONTAINER, '5432/tcp'], {
      encoding: 'utf8',
    }).trim();
    const port = binding.slice(binding.lastIndexOf(':') + 1);
    const baseUrl = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${port}/${DATABASE}`;
    await waitForReady(baseUrl);

    const admin = new Pool({ connectionString: baseUrl });
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    await admin.end();

    const schemaUrl = new URL(baseUrl);
    schemaUrl.searchParams.set('options', `-csearch_path=${SCHEMA}`);
    process.env.DATABASE_URL = schemaUrl.toString();
    process.env.DATABASE_URL_TEST = schemaUrl.toString();
  } catch (error) {
    removeContainer();
    throw error;
  }
}

export function teardown(): void {
  removeContainer();
}
