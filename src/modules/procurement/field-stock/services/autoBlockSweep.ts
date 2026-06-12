/**
 * autoBlockSweep — Tier 3.2 (SOP-4.4) proactive holder auto-block sweep.
 *
 * Scans EVERY holder with at least one `aged_no_evidence` serial (mig 410 view),
 * applies the `stock_accountability_config` policy (mig 411), and commits a block
 * on each holder over threshold. This is the proactive counterpart to the
 * issue-time guard (`assertHolderAutoBlock`): it surfaces blocked holders in the
 * Accountability tab even if they never try to draw more stock.
 *
 * Takes a `Querier` so it runs unchanged from:
 *   - the withAuth sweep endpoint (pool-level `query` from db-pool), and
 *   - the inert tsx cron runner (its own `pg.Pool`, no db-pool/neon-shim import).
 *
 * Writes are pool-level and individually committed (no wrapping transaction): one
 * holder failing must not roll back blocks already applied to others.
 */
import {
  type Querier,
  loadAutoBlockPolicy,
  autoBlockHolder,
} from './holderBlockGuard';
import { evaluateAutoBlock, formatBlockReason } from './autoBlockPolicy';

/** One holder newly blocked by a sweep. */
export interface SweptHolder {
  holderId: string;
  agedCount: number;
  agedValue: number;
  reason: string;
}

/** Summary returned by `runAutoBlockSweep`. */
export interface AutoBlockSweepResult {
  /** False when the policy is disabled — the sweep does nothing in that case. */
  enabled: boolean;
  /** Holders considered (those with ≥ 1 aged_no_evidence serial). */
  evaluated: number;
  /** Holders this sweep flipped to blocked. */
  blocked: SweptHolder[];
  /** Holders over threshold that were already blocked (no-op upserts). */
  alreadyBlocked: number;
}

interface SweepRow extends Record<string, unknown> {
  holder_id: string;
  aged_count: string | number;
  aged_value: string | number;
}

/**
 * Run the sweep. Returns immediately (enabled:false, nothing written) when the
 * policy is disabled — the master switch ships off (mig 411).
 *
 * @param q        query function (pool-level or a cron's own pool wrapper)
 * @param blockedBy provenance tag written to `stock_accountability.blocked_by`.
 */
export async function runAutoBlockSweep(
  q: Querier,
  blockedBy = 'auto-block:sweep',
): Promise<AutoBlockSweepResult> {
  const policy = await loadAutoBlockPolicy(q);
  if (!policy.enabled) {
    return { enabled: false, evaluated: 0, blocked: [], alreadyBlocked: 0 };
  }

  // One row per holder holding aged_no_evidence serials, with count + ZAR value.
  const rows = await q<SweepRow>(
    `SELECT
        e.holder_id,
        COUNT(*) FILTER (WHERE e.exception_class = 'aged_no_evidence') AS aged_count,
        COALESCE(
          SUM(si.standard_cost) FILTER (WHERE e.exception_class = 'aged_no_evidence'),
          0
        ) AS aged_value
       FROM v_holder_stock_exceptions e
       LEFT JOIN stock_items si ON si.id = e.stock_item_id
      GROUP BY e.holder_id
     HAVING COUNT(*) FILTER (WHERE e.exception_class = 'aged_no_evidence') > 0`,
  );

  const blocked: SweptHolder[] = [];
  let alreadyBlocked = 0;

  for (const row of rows) {
    const metrics = {
      agedCount: Number(row.aged_count),
      agedValue: Number(row.aged_value),
    };
    const decision = evaluateAutoBlock(policy, metrics);
    if (!decision.block) continue;

    const reason = formatBlockReason(metrics, decision);
    const newlyBlocked = await autoBlockHolder(q, row.holder_id, reason, blockedBy);
    if (newlyBlocked) {
      blocked.push({ holderId: row.holder_id, ...metrics, reason });
    } else {
      alreadyBlocked += 1;
    }
  }

  return { enabled: true, evaluated: rows.length, blocked, alreadyBlocked };
}
