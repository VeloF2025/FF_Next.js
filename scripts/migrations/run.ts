#!/usr/bin/env tsx
/**
 * Migration CLI — Supabase/Postgres.
 *
 *   npm run db:migrate                # apply pending migrations
 *   npm run db:migrate rollback 301   # roll back migration 301
 *
 * Forward migrations are delegated to scripts/run-pending-migrations.sh — the
 * single canonical runner, which tracks applied migrations by FILENAME in
 * `schema_migrations`. Keying by filename (not the 3-digit version prefix) means
 * files that share a version — e.g. two `411_*` from parallel branches — are BOTH
 * applied, and a genuine conflict aborts loudly instead of silently skipping the
 * second file (the bug this used to have). It is also the exact runner the deploy
 * uses (scripts/deploy-local.sh), so `npm run db:migrate` and deploys cannot diverge.
 *
 * Rollback stays here (pg driver): it runs the matching rollback_<version>_*.sql
 * and deletes the legacy `migrations` row.
 *
 * Rollback file lookup (first hit wins):
 *   1. scripts/migrations/sql/rollbacks/<version>_*.down.sql   (legacy)
 *   2. scripts/migrations/sql/rollback_<version>_*.sql         (current)
 */

import { Pool } from 'pg';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, 'sql');
const REPO_ROOT = path.join(__dirname, '..', '..');

// CLI output — this is a terminal tool, not app code, so write directly to the
// streams (the pino app logger emits JSON and is silent under tsx).
const out = (msg: string): void => { process.stdout.write(`${msg}\n`); };
const err = (msg: string): void => { process.stderr.write(`${msg}\n`); };
const asMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function runPendingMigrations() {
  const runner = path.join(REPO_ROOT, 'scripts', 'run-pending-migrations.sh');
  if (!fs.existsSync(runner)) {
    throw new Error(`Canonical migration runner not found at ${runner}`);
  }
  // run.ts historically used DATABASE_URL_MIGRATIONS for the superuser URL; the
  // shell runner reads MIGRATION_DATABASE_URL from .env*. Bridge them so an
  // env-only superuser URL is still honoured (MIGRATION_URL is the runner's own
  // connection variable — seeding it skips its .env lookup).
  const env = { ...process.env };
  if (!process.env.MIGRATION_DATABASE_URL && process.env.DATABASE_URL_MIGRATIONS) {
    env.MIGRATION_URL = process.env.DATABASE_URL_MIGRATIONS;
  }
  execFileSync('bash', [runner], { stdio: 'inherit', cwd: REPO_ROOT, env });
}

function resolveMigrationPool(): Pool {
  const migrationUrl = process.env.DATABASE_URL_MIGRATIONS ?? process.env.DATABASE_URL;
  if (!migrationUrl) {
    throw new Error('Neither DATABASE_URL_MIGRATIONS nor DATABASE_URL is set.');
  }
  if (!process.env.DATABASE_URL_MIGRATIONS) {
    err(
      '⚠ DATABASE_URL_MIGRATIONS not set — falling back to DATABASE_URL. ' +
      'Rollback may fail if the connection user lacks the required privileges.'
    );
  }
  const useSSL = migrationUrl.includes('sslmode=require');
  return new Pool({
    connectionString: migrationUrl,
    ssl: useSSL ? { rejectUnauthorized: false } : false,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 30_000,
  });
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
  out(`Rolling back migration: ${version}`);
  const rollbackPath = findRollbackFile(version);
  if (!rollbackPath) {
    throw new Error(
      `No rollback file found for migration ${version}. ` +
      `Expected scripts/migrations/sql/rollback_${version}_*.sql ` +
      `or scripts/migrations/sql/rollbacks/${version}_*.down.sql`
    );
  }

  out(`Using rollback file: ${path.basename(rollbackPath)}`);
  const sqlText = fs.readFileSync(rollbackPath, 'utf-8');

  const pool = resolveMigrationPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sqlText);
    await client.query(`DELETE FROM migrations WHERE version = $1`, [version]);
    await client.query('COMMIT');
    out(`✓ Rollback ${version} completed`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    err(`✗ Rollback ${version} failed: ${asMessage(error)}`);
    throw error;
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}

async function main() {
  const command = process.argv[2];
  try {
    if (command === 'rollback') {
      const version = process.argv[3];
      if (!version) {
        err('Please specify migration version to rollback (e.g., 301)');
        process.exitCode = 1;
        return;
      }
      await rollbackMigration(version);
    } else {
      runPendingMigrations();
    }
  } catch (error) {
    err(`Migration failed: ${asMessage(error)}`);
    process.exitCode = 1;
  }
}

main();
