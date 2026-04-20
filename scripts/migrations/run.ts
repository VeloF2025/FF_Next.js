#!/usr/bin/env tsx
/**
 * Migration runner — Supabase/Postgres (pg driver).
 *
 * Applies raw SQL files from scripts/migrations/sql/ in filename order.
 * Each migration runs inside a single transaction on a dedicated client,
 * so BEGIN/COMMIT/ROLLBACK actually bind together. The whole file is
 * passed to pg as a multi-statement string — no naive `.split(';')`.
 *
 * Connection:
 *   - Prefers DATABASE_URL_MIGRATIONS (must be a superuser / schema-owner URL)
 *   - Falls back to DATABASE_URL (will fail on CREATE TABLE in least-privilege
 *     setups like Supabase where the app user is `fibreflow_user`)
 *
 * Usage:
 *   npm run db:migrate                    # apply pending migrations
 *   npm run db:migrate rollback 301       # rollback 301 using rollback_301_*.sql
 *
 * Rollback lookup order (first hit wins):
 *   1. scripts/migrations/sql/rollbacks/<version>_*.down.sql   (legacy path)
 *   2. scripts/migrations/sql/rollback_<version>_*.sql         (current convention)
 */

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const migrationUrl = process.env.DATABASE_URL_MIGRATIONS ?? process.env.DATABASE_URL;
if (!migrationUrl) {
  console.error('ERROR: Neither DATABASE_URL_MIGRATIONS nor DATABASE_URL is set.');
  process.exit(1);
}
if (!process.env.DATABASE_URL_MIGRATIONS) {
  console.warn(
    '⚠ DATABASE_URL_MIGRATIONS not set — falling back to DATABASE_URL. ' +
    'This will fail if the connection user lacks CREATE TABLE rights on schema public ' +
    '(typical for Supabase `fibreflow_user`). Set DATABASE_URL_MIGRATIONS to a superuser URL.'
  );
}

const useSSL = migrationUrl.includes('sslmode=require');
const pool = new Pool({
  connectionString: migrationUrl,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 30_000,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, 'sql');

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      version VARCHAR(20) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      executed_at TIMESTAMP DEFAULT NOW(),
      execution_time_ms INTEGER,
      success BOOLEAN DEFAULT true,
      error_message TEXT
    )
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const { rows } = await pool.query<{ version: string }>(
    `SELECT version FROM migrations WHERE success = true ORDER BY version`
  );
  return new Set(rows.map(r => r.version));
}

async function runMigration(filePath: string, fileName: string) {
  const match = fileName.match(/^(\d{3})_(.+)\.sql$/);
  if (!match) throw new Error(`Invalid migration filename: ${fileName}`);

  const [, version, name] = match;
  const sqlText = fs.readFileSync(filePath, 'utf-8');
  const startedAt = Date.now();

  console.log(`▶ ${version}: ${name}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sqlText);
    const elapsed = Date.now() - startedAt;
    await client.query(
      `INSERT INTO migrations (version, name, execution_time_ms, success)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (version) DO NOTHING`,
      [version, name.replace(/_/g, ' '), elapsed]
    );
    await client.query('COMMIT');
    console.log(`✓ ${version} applied in ${elapsed}ms`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    await pool.query(
      `INSERT INTO migrations (version, name, execution_time_ms, success, error_message)
       VALUES ($1, $2, $3, false, $4)
       ON CONFLICT (version) DO UPDATE
         SET error_message = EXCLUDED.error_message, success = false`,
      [version, name.replace(/_/g, ' '), Date.now() - startedAt, message]
    ).catch(() => {});
    console.error(`✗ ${version} failed: ${message}`);
    throw error;
  } finally {
    client.release();
  }
}

async function runPendingMigrations() {
  console.log('Starting database migrations...\n');
  await ensureMigrationsTable();

  const applied = await getAppliedMigrations();
  console.log(`Found ${applied.size} applied migrations`);

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
    console.log('Created migrations/sql directory');
  }

  const pending = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d{3}_.+\.sql$/.test(f))
    .sort()
    .filter(f => {
      const version = f.match(/^(\d{3})_/)![1];
      return !applied.has(version);
    });

  if (pending.length === 0) {
    console.log('No pending migrations');
    return;
  }

  console.log(`\nFound ${pending.length} pending migrations:`);
  pending.forEach(m => console.log(`  - ${m}`));
  console.log('');

  for (const fileName of pending) {
    await runMigration(path.join(MIGRATIONS_DIR, fileName), fileName);
  }

  console.log('\n✓ All migrations completed successfully');
}

function findRollbackFile(version: string): string | null {
  // Current project convention: scripts/migrations/sql/rollback_<version>_*.sql
  const currentConv = fs.readdirSync(MIGRATIONS_DIR)
    .find(f => f.startsWith(`rollback_${version}_`) && f.endsWith('.sql'));
  if (currentConv) return path.join(MIGRATIONS_DIR, currentConv);

  // Legacy convention (documented in README): sql/rollbacks/<version>_*.down.sql
  const legacyDir = path.join(MIGRATIONS_DIR, 'rollbacks');
  if (fs.existsSync(legacyDir)) {
    const legacy = fs.readdirSync(legacyDir)
      .find(f => f.startsWith(`${version}_`) && f.endsWith('.down.sql'));
    if (legacy) return path.join(legacyDir, legacy);
  }

  return null;
}

async function rollbackMigration(version: string) {
  console.log(`Rolling back migration: ${version}`);
  const rollbackPath = findRollbackFile(version);
  if (!rollbackPath) {
    throw new Error(
      `No rollback file found for migration ${version}. ` +
      `Expected scripts/migrations/sql/rollback_${version}_*.sql ` +
      `or scripts/migrations/sql/rollbacks/${version}_*.down.sql`
    );
  }

  console.log(`Using rollback file: ${path.basename(rollbackPath)}`);
  const sqlText = fs.readFileSync(rollbackPath, 'utf-8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sqlText);
    await client.query(`DELETE FROM migrations WHERE version = $1`, [version]);
    await client.query('COMMIT');
    console.log(`✓ Rollback ${version} completed`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`✗ Rollback ${version} failed:`, error);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const command = process.argv[2];
  try {
    if (command === 'rollback') {
      const version = process.argv[3];
      if (!version) {
        console.error('Please specify migration version to rollback (e.g., 301)');
        process.exit(1);
      }
      await rollbackMigration(version);
    } else {
      await runPendingMigrations();
    }
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
