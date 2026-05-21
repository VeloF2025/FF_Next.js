#!/usr/bin/env tsx
/**
 * reconcile-serials.ts — Serial Master Register validation-gate CLI.
 *
 * Reads reconcile-queries.sql, parses each named check with its tolerance,
 * runs them against DATABASE_URL, prints [OK ] / [FAIL] lines, exits 0 if
 * all pass, 1 if any fail.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/reconcile-serials.ts
 *   npm run reconcile:serials
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import { Pool } from 'pg';
import { log } from '../src/lib/logger';

interface CheckSpec {
  name: string;
  tolerance: number;
  sql: string;
}

function parseChecks(source: string): CheckSpec[] {
  const blocks = source.split(/(?=--\s*@name\s)/);
  const checks: CheckSpec[] = [];

  for (const block of blocks) {
    const nameMatch = block.match(/--\s*@name\s+(\S+)/);
    if (!nameMatch) continue;

    const name = nameMatch[1];

    const tolMatch = block.match(/--\s*Tolerance:\s*(\d+)/);
    const tolerance = tolMatch ? parseInt(tolMatch[1], 10) : 0;

    // Extract the SQL statement (everything after the comment lines).
    const sqlMatch = block.match(/SELECT[\s\S]+?;/);
    if (!sqlMatch) {
      log.warn('reconcile-serials: no SQL found in block', { name });
      continue;
    }
    checks.push({ name, tolerance, sql: sqlMatch[0].trim() });
  }

  return checks;
}

interface CheckResult {
  name: string;
  tolerance: number;
  drift: number;
  passed: boolean;
}

async function runChecks(
  pool: Pool,
  checks: CheckSpec[],
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const check of checks) {
    const r = await pool.query<{ drift_count: string }>(check.sql);
    const drift = parseInt(r.rows[0]?.drift_count ?? '0', 10);
    const passed = drift <= check.tolerance;
    results.push({ name: check.name, tolerance: check.tolerance, drift, passed });
  }

  return results;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? process.env.DATABASE_URL_TEST;
  if (!url) {
    process.stderr.write('ERROR: DATABASE_URL not set\n');
    process.exit(1);
  }

  const sqlPath = path.join(
    __dirname,
    'migrations',
    'sql',
    'reconcile-queries.sql',
  );
  const source = fs.readFileSync(sqlPath, 'utf8');
  const checks = parseChecks(source);

  if (checks.length === 0) {
    process.stderr.write('ERROR: no checks parsed from reconcile-queries.sql\n');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  let allPassed = true;

  try {
    const results = await runChecks(pool, checks);

    for (const r of results) {
      const tag = r.passed ? '[OK ]' : '[FAIL]';
      const line = `${tag} ${r.name}: drift=${r.drift} (tolerance=${r.tolerance})`;
      process.stdout.write(line + '\n');
      if (!r.passed) {
        allPassed = false;
        log.warn('reconcile-serials: check failed', {
          name: r.name,
          drift: r.drift,
          tolerance: r.tolerance,
        });
      }
    }

    if (allPassed) {
      process.stdout.write(`\nAll ${results.length} checks passed.\n`);
    } else {
      const failed = results.filter(x => !x.passed).length;
      process.stdout.write(`\n${failed} of ${results.length} checks FAILED.\n`);
    }
  } finally {
    await pool.end();
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch((err: unknown) => {
  log.error('reconcile-serials: unexpected error', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
