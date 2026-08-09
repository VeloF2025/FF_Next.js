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
  if (!process.env.MIGRATION_URL && process.env.DATABASE_URL_MIGRATIONS) {
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

/**
 * Refuses to guess when a number is ambiguous.
 *
 * Migration numbers are not unique in this repo — 7 numbers currently carry two
 * or more forward migrations (401 has three), because branches pick MAX+1
 * independently and collide on merge. `.find()` returned whichever entry
 * `readdirSync` happened to list first, which is filesystem order, not sorted:
 * `rollback 485` resolved to the FLEET migration's rollback while the operator
 * meant the zone-delivery one, silently reverting an unrelated live change and
 * reporting success. Throwing costs one manual disambiguation; guessing costs a
 * production revert nobody asked for.
 */
function findRollbackFile(version: string): string | null {
  // Current project convention: scripts/migrations/sql/rollback_<version>_*.sql
  const currentConv = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.startsWith(`rollback_${version}_`) && f.endsWith('.sql'))
    .sort();
  if (currentConv.length > 1) {
    throw new Error(
      `Migration number ${version} is ambiguous — ${currentConv.length} rollback files match:\n` +
      currentConv.map(f => `  - ${f}`).join('\n') +
      `\nRe-run with the exact filename instead of the number, so the wrong ` +
      `migration is not reverted.`
    );
  }
  if (currentConv.length === 1) return path.join(MIGRATIONS_DIR, currentConv[0]!);

  // Legacy convention (documented in README): sql/rollbacks/<version>_*.down.sql
  const legacyDir = path.join(MIGRATIONS_DIR, 'rollbacks');
  if (fs.existsSync(legacyDir)) {
    const legacy = fs.readdirSync(legacyDir)
      .filter(f => f.startsWith(`${version}_`) && f.endsWith('.down.sql'))
      .sort();
    if (legacy.length > 1) {
      throw new Error(
        `Migration number ${version} is ambiguous — ${legacy.length} legacy rollback files match:\n` +
        legacy.map(f => `  - ${f}`).join('\n')
      );
    }
    if (legacy.length === 1) return path.join(legacyDir, legacy[0]!);
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

  const rollbackName = path.basename(rollbackPath);
  out(`Using rollback file: ${rollbackName}`);
  const sqlText = fs.readFileSync(rollbackPath, 'utf-8');

  // The forward migration's filename — needed to clear the canonical
  // schema_migrations tracker (keyed by filename), so the deploy/forward runner
  // will re-apply it after rollback. Derived exactly from the rollback filename
  // (NOT by version prefix — files can share a version, e.g. two 411_*).
  const forwardFilename = rollbackName.startsWith('rollback_')
    ? rollbackName.slice('rollback_'.length)
    : rollbackName.replace(/\.down\.sql$/, '.sql');

  const pool = resolveMigrationPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sqlText);
    await client.query(`DELETE FROM migrations WHERE version = $1`, [version]);
    await client.query(`DELETE FROM schema_migrations WHERE filename = $1`, [forwardFilename]);
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
