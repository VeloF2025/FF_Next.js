/** Serial-register reconciliation (PR-11). Read-only drift detection: each named
 * invariant check from reconcile-queries.sql returns a drift count compared to a
 * tolerance. This is observability only — no remediation/write surface. */

export interface ReconciliationCheckResult {
  /** Stable check id from the `-- @name` comment (e.g. 'latest_event_matches_status'). */
  name: string;
  /** Max drift allowed before the check is considered failing. */
  tolerance: number;
  /** Actual drift count from the check's COUNT(*) query. */
  drift: number;
  /** drift <= tolerance. */
  passed: boolean;
}

export interface ReconciliationSummary {
  checks: ReconciliationCheckResult[];
  /** ISO timestamp of when these results were produced (server-side). */
  ranAt: string;
  /** True when every check passed. */
  allPassed: boolean;
}
