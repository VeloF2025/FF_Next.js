/**
 * autoBlockPolicy — pure threshold logic for Tier 3.2 holder auto-block (SOP-4.4).
 *
 * No DB, no React, no fetch — safe to import anywhere and unit-testable in
 * isolation (mirrors how `stockValueGuard` keeps the cap maths pure). The DB reads
 * (policy row + per-holder aged metrics) and the block write live in
 * `holderBlockGuard.ts`; this module only decides, given a policy + metrics,
 * whether a holder should be blocked and how to phrase the reason.
 *
 * Driver: the `aged_no_evidence` class from `v_holder_stock_exceptions` (mig 410) —
 * serials held by a field holder for 30+ days with NO OES/WA activation evidence
 * (genuine loss / recovery candidates). A holder is auto-blocked when EITHER the
 * count OR the Rand value of those serials reaches the configured threshold.
 */

/** Policy row from `stock_accountability_config` (mig 411). */
export interface AutoBlockPolicy {
  /** Master switch. When false, `evaluateAutoBlock` never blocks. */
  enabled: boolean;
  /** Block when aged_no_evidence serial COUNT ≥ this (≥ 1). */
  agedCountThreshold: number;
  /** Block when aged_no_evidence serial VALUE (ZAR) ≥ this (≥ 0). */
  agedValueThreshold: number;
}

/** Per-holder aged-unaccounted metrics derived from `v_holder_stock_exceptions`. */
export interface HolderAgedMetrics {
  /** Count of the holder's `aged_no_evidence` serials. */
  agedCount: number;
  /** Sum of `stock_items.standard_cost` over those serials, in ZAR. */
  agedValue: number;
}

/** Outcome of evaluating a policy against a holder's metrics. */
export interface AutoBlockDecision {
  /** True when the policy is enabled and at least one threshold is met. */
  block: boolean;
  /** Human-readable list of the threshold(s) that tripped (empty when not blocked). */
  reasons: string[];
}

/**
 * Default policy used when the config row is absent. DISABLED — the feature ships
 * off and must be deliberately armed (see migration 411).
 */
export const DEFAULT_AUTO_BLOCK_POLICY: AutoBlockPolicy = {
  enabled: false,
  agedCountThreshold: 3,
  agedValueThreshold: 5000,
};

/**
 * Decide whether a holder should be auto-blocked.
 *
 * Threshold semantics are `>=` (inclusive): a holder with exactly
 * `agedCountThreshold` aged serials IS blocked. Count and value are OR'd — either
 * tripping is sufficient. A disabled policy always returns `block: false`.
 */
export function evaluateAutoBlock(
  policy: AutoBlockPolicy,
  metrics: HolderAgedMetrics,
): AutoBlockDecision {
  if (!policy.enabled) {
    return { block: false, reasons: [] };
  }

  const reasons: string[] = [];
  if (metrics.agedCount >= policy.agedCountThreshold) {
    reasons.push(`aged count ${metrics.agedCount} ≥ ${policy.agedCountThreshold}`);
  }
  if (metrics.agedValue >= policy.agedValueThreshold) {
    reasons.push(
      `aged value R${metrics.agedValue.toFixed(2)} ≥ R${policy.agedValueThreshold.toFixed(2)}`,
    );
  }

  return { block: reasons.length > 0, reasons };
}

/**
 * Compose the `stock_accountability.blocked_reason` text written when a holder is
 * auto-blocked. Encodes the metrics + the tripped threshold(s) so the
 * Accountability UI / 409 response explains exactly why the holder was blocked.
 */
export function formatBlockReason(
  metrics: HolderAgedMetrics,
  decision: AutoBlockDecision,
): string {
  return (
    `Auto-blocked (SOP-4.4): ${metrics.agedCount} aged unaccounted serial(s) ` +
    `worth R${metrics.agedValue.toFixed(2)} — ${decision.reasons.join('; ')}`
  );
}
