import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { Pool } from 'pg';

const COMPOSE = 'tests/db/setup/docker-compose.test.yml';
const URL = 'postgres://fibreflow_test:fibreflow_test@localhost:55432/fibreflow_test';

export async function setup() {
  execFileSync('docker-compose',
    ['-f', COMPOSE, 'up', '-d', '--wait'],
    { stdio: 'inherit' });

  const seed = await fs.readFile(path.join(process.cwd(),
    'tests/db/setup/seed.sql'), 'utf8');
  const migration = await fs.readFile(path.join(process.cwd(),
    'scripts/migrations/sql/362_serial_master_register.sql'), 'utf8');

  const pool = new Pool({ connectionString: URL });
  await pool.query(seed);
  await pool.query(migration);
  await pool.end();

  process.env.DATABASE_URL_TEST = URL;
}

export async function teardown() {
  execFileSync('docker-compose', ['-f', COMPOSE, 'down', '-v'],
    { stdio: 'inherit' });
}
