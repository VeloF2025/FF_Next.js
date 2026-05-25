/**
 * Serial-register reconciliation service (PR-11) — read-only drift detection.
 *
 * Runs the same named invariant checks the CLI runs (parsed from
 * reconcile-queries.sql via the shared loader), each returning COUNT(*) AS
 * drift_count, and maps them to pass/fail against their tolerance.
 *
 * Checks run SEQUENTIALLY on purpose: dev + prod share one Supabase DB, and
 * several checks scan stock_serials / UNNEST picking arrays — firing all of
 * them in parallel would put avoidable concurrent load on the live DB.
 */
import { query } from '@/lib/db-pool';
import { loadReconcileChecks } from './reconcileChecks';
import type { ReconciliationCheckResult, ReconciliationSummary } from '@/types/field-stock';

export async function getSerialReconciliationSummary(): Promise<ReconciliationSummary> {
  const checks = loadReconcileChecks();
  const results: ReconciliationCheckResult[] = [];

  for (const check of checks) {
    const rows = await query<{ drift_count: string | number }>(check.sql);
    const drift = Number(rows[0]?.drift_count ?? 0) || 0;
    results.push({
      name: check.name,
      tolerance: check.tolerance,
      drift,
      passed: drift <= check.tolerance,
    });
  }

  return {
    checks: results,
    ranAt: new Date().toISOString(),
    allPassed: results.every((r) => r.passed),
  };
}
