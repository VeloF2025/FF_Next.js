/**
 * Shared parser for the serial-register reconcile checks.
 *
 * Single source of truth for `scripts/migrations/sql/reconcile-queries.sql`:
 * both the CLI (`scripts/reconcile-serials.ts`) and the read-only PR-11 API
 * (`/api/procurement/field-stock/serial-reconciliation`) parse the same file
 * through this module so check names + tolerances never diverge.
 */
import * as path from 'node:path';
import * as fs from 'node:fs';

export interface CheckSpec {
  name: string;
  tolerance: number;
  sql: string;
}

/** Path to the canonical reconcile-queries.sql, relative to the repo root. */
export const RECONCILE_SQL_RELPATH = 'scripts/migrations/sql/reconcile-queries.sql';

/**
 * Parse the `-- @name` / `-- Tolerance:` annotated SQL file into check specs.
 * Blocks without a `@name` or without a SELECT statement are skipped (they are
 * the file header / comments), so the result contains only runnable checks.
 */
export function parseChecks(source: string): CheckSpec[] {
  const blocks = source.split(/(?=--\s*@name\s)/);
  const checks: CheckSpec[] = [];

  for (const block of blocks) {
    const name = block.match(/--\s*@name\s+(\S+)/)?.[1];
    if (!name) continue;

    const tol = block.match(/--\s*Tolerance:\s*(\d+)/)?.[1];
    const tolerance = tol ? parseInt(tol, 10) : 0;

    const sql = block.match(/SELECT[\s\S]+?;/)?.[0];
    if (!sql) continue;

    checks.push({ name, tolerance, sql: sql.trim() });
  }

  return checks;
}

/**
 * Load + parse the reconcile checks from disk. Resolved from `process.cwd()`,
 * which is the repo root under `next start` (next.config has no standalone
 * output, so `scripts/` ships in the deployed tree). Throws if the file is
 * missing or yields zero checks — callers surface this as a 500, never silently.
 */
export function loadReconcileChecks(): CheckSpec[] {
  const filePath = path.join(process.cwd(), RECONCILE_SQL_RELPATH);
  const source = fs.readFileSync(filePath, 'utf8');
  const checks = parseChecks(source);
  if (checks.length === 0) {
    throw new Error(`No reconcile checks parsed from ${RECONCILE_SQL_RELPATH}`);
  }
  return checks;
}
