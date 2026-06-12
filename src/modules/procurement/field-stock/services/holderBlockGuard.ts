/**
 * Sprint E Track 4.1 (SOP-4.4): issue-time block enforcement.
 *
 * Refuses to issue stock to a blocked holder. `is_blocked` is read from
 * `v_holder_accountability` (sourced from `stock_accountability.is_blocked`,
 * mig 384). The picking-process handler calls this after resolving the recipient
 * holder and BEFORE any custody/serial write, then maps `HolderBlockedError` to
 * an HTTP 409 so the PWA can surface the reason to the user.
 *
 * Kept as a standalone helper (rather than inline in the handler) so the guard is
 * unit-testable in isolation — mirroring how `promoteSerial` is exercised directly
 * in the Sprint E DB tests.
 *
 * Tier 3.2 (SOP-4.4 auto-block) extends this module with the THRESHOLD-DRIVEN
 * auto-block: `assertHolderAutoBlock` evaluates a holder's `aged_no_evidence`
 * exceptions (mig 410 view) against the `stock_accountability_config` policy
 * (mig 411) and throws `HolderAutoBlockedError` when over threshold; `autoBlockHolder`
 * commits the block. The DB-touching helpers take a generic `Querier` so the same
 * code serves both the issue-time transaction (TxnClient) and the nightly sweep /
 * cron (pool-level query).
 */
import type { TxnClient } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import {
  type AutoBlockPolicy,
  type HolderAgedMetrics,
  DEFAULT_AUTO_BLOCK_POLICY,
  evaluateAutoBlock,
  formatBlockReason,
} from './autoBlockPolicy';

/**
 * Minimal query interface shared by `TxnClient.query` and the pool-level `query`
 * from db-pool, so the auto-block helpers run unchanged inside an issue-time
 * transaction or against a plain pool (sweep endpoint / cron).
 */
export type Querier = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

/** Thrown when an issue picking targets a holder flagged `is_blocked` in accountability. */
export class HolderBlockedError extends Error {
  readonly holderId: string;
  readonly blockedReason: string | null;

  constructor(holderId: string, blockedReason: string | null) {
    super(`holder_blocked: ${holderId}`);
    this.name = 'HolderBlockedError';
    this.holderId = holderId;
    this.blockedReason = blockedReason;
  }
}

interface BlockRow extends Record<string, unknown> {
  is_blocked: boolean;
  blocked_reason: string | null;
}

/**
 * Throw `HolderBlockedError` if the holder is currently blocked; no-op otherwise.
 *
 * A holder with no `stock_accountability` row is NOT blocked — the view COALESCEs
 * `is_blocked` to false, and a missing view row (`rows[0]` undefined) is treated as
 * not-blocked. Runs inside the caller's transaction so a throw rolls back any work
 * the handler did before the guard.
 */
export async function assertHolderNotBlocked(
  txn: TxnClient,
  holderId: string,
): Promise<void> {
  const rows = await txn.query<BlockRow>(
    `SELECT is_blocked, blocked_reason
       FROM v_holder_accountability
      WHERE holder_id = $1`,
    [holderId],
  );
  const row = rows[0];
  if (row?.is_blocked) {
    throw new HolderBlockedError(holderId, row.blocked_reason);
  }
}

// ============================================================================
// Tier 3.2 (SOP-4.4): threshold-driven auto-block
// ============================================================================

/**
 * Thrown when a holder crosses the auto-block threshold at issue time. The
 * picking-process handler catches this OUTSIDE its transaction and commits the
 * block via `autoBlockHolder` before returning 409 — the block must survive the
 * issue txn's rollback, so it is never written inside that txn.
 */
export class HolderAutoBlockedError extends Error {
  readonly holderId: string;
  readonly blockedReason: string;
  readonly metrics: HolderAgedMetrics;

  constructor(holderId: string, blockedReason: string, metrics: HolderAgedMetrics) {
    super(`holder_auto_blocked: ${holderId}`);
    this.name = 'HolderAutoBlockedError';
    this.holderId = holderId;
    this.blockedReason = blockedReason;
    this.metrics = metrics;
  }
}

interface PolicyRow extends Record<string, unknown> {
  auto_block_enabled: boolean;
  aged_count_threshold: number;
  aged_value_threshold: string | number;
}

interface AgedMetricsRow extends Record<string, unknown> {
  aged_count: string | number;
  aged_value: string | number;
}

/**
 * Load the singleton auto-block policy (`stock_accountability_config`, mig 411).
 * A missing row/table → `DEFAULT_AUTO_BLOCK_POLICY` (disabled) so the guard is a
 * safe no-op before/without the migration.
 */
export async function loadAutoBlockPolicy(q: Querier): Promise<AutoBlockPolicy> {
  let rows: PolicyRow[];
  try {
    rows = await q<PolicyRow>(
      `SELECT auto_block_enabled, aged_count_threshold, aged_value_threshold
         FROM stock_accountability_config
        WHERE id = 1`,
    );
  } catch (err: unknown) {
    // 42P01 = relation does not exist: migration 411 not yet applied (fresh clone,
    // restored snapshot, partial migration). Treat as the disabled default so the
    // issue-time guard never 500s a picking on a missing config table. Re-throw any
    // other error (real connectivity/permission failures must surface).
    if ((err as { code?: string }).code === '42P01') return DEFAULT_AUTO_BLOCK_POLICY;
    throw err;
  }
  const row = rows[0];
  if (!row) return DEFAULT_AUTO_BLOCK_POLICY;
  return {
    enabled: row.auto_block_enabled === true,
    agedCountThreshold: Number(row.aged_count_threshold),
    agedValueThreshold: Number(row.aged_value_threshold),
  };
}

/**
 * Aged-unaccounted metrics for one holder: count + ZAR value of its
 * `aged_no_evidence` serials (mig 410 view). `standard_cost` is the per-serial
 * value (each held serial = 1 unit); a NULL cost contributes 0.
 */
export async function getHolderAgedMetrics(
  q: Querier,
  holderId: string,
): Promise<HolderAgedMetrics> {
  const rows = await q<AgedMetricsRow>(
    `SELECT
        COUNT(*) FILTER (WHERE e.exception_class = 'aged_no_evidence') AS aged_count,
        COALESCE(
          SUM(si.standard_cost) FILTER (WHERE e.exception_class = 'aged_no_evidence'),
          0
        ) AS aged_value
       FROM v_holder_stock_exceptions e
       LEFT JOIN stock_items si ON si.id = e.stock_item_id
      WHERE e.holder_id = $1`,
    [holderId],
  );
  const row = rows[0];
  return {
    agedCount: Number(row?.aged_count ?? 0),
    agedValue: Number(row?.aged_value ?? 0),
  };
}

/**
 * Commit an auto-block on a holder (idempotent). Upserts `stock_accountability`,
 * setting `is_blocked` only when it was previously false — so a holder already
 * blocked (manually or by an earlier run) keeps its original reason/timestamp and
 * this is a no-op. Returns true only when THIS call flipped the holder to blocked.
 *
 * @param blockedBy provenance tag, e.g. 'auto-block:issue-guard' / 'auto-block:sweep'.
 */
export async function autoBlockHolder(
  q: Querier,
  holderId: string,
  reason: string,
  blockedBy: string,
): Promise<boolean> {
  const rows = await q(
    `INSERT INTO stock_accountability (holder_id, is_blocked, blocked_reason, blocked_at, blocked_by, updated_at)
     VALUES ($1, true, $2, NOW(), $3, NOW())
     ON CONFLICT (holder_id) DO UPDATE
       SET is_blocked      = true,
           blocked_reason  = EXCLUDED.blocked_reason,
           blocked_at      = NOW(),
           blocked_by      = EXCLUDED.blocked_by,
           updated_at      = NOW()
     WHERE stock_accountability.is_blocked = false
     RETURNING holder_id`,
    [holderId, reason, blockedBy],
  );
  return rows.length > 0;
}

/**
 * Issue-time auto-block evaluation. Loads the policy, computes the holder's aged
 * metrics, and — if the policy is enabled AND a threshold is met — throws
 * `HolderAutoBlockedError` (carrying the reason + metrics). Writes NOTHING: the
 * caller commits the block from its catch block, after its transaction rolls back.
 *
 * Intended to run AFTER `assertHolderNotBlocked` (which handles an already-blocked
 * holder with its existing reason), so this only fires for a holder newly crossing
 * the threshold. A disabled policy is an immediate no-op.
 */
export async function assertHolderAutoBlock(txn: TxnClient, holderId: string): Promise<void> {
  // Inline wrapper (not txn.query.bind) so the Querier generic is preserved —
  // .bind() on a generic method erases the type parameter.
  const q: Querier = (text, params) => txn.query(text, params);

  const policy = await loadAutoBlockPolicy(q);
  if (!policy.enabled) return;

  const metrics = await getHolderAgedMetrics(q, holderId);
  const decision = evaluateAutoBlock(policy, metrics);
  if (!decision.block) return;

  throw new HolderAutoBlockedError(holderId, formatBlockReason(metrics, decision), metrics);
}

/**
 * Commit an auto-block triggered at issue time, from OUTSIDE the (now rolled-back)
 * issue transaction. The picking handler calls this from its catch block: the block
 * must be written on a fresh pool connection so it survives the rollback that
 * refused the issue. A failed write is swallowed + logged (never masks the 409) —
 * the holder is genuinely over threshold, so the next issue attempt or the nightly
 * sweep re-evaluates and re-blocks. Returns the 409 response payload.
 */
export async function commitAutoBlockRefusal(
  q: Querier,
  error: HolderAutoBlockedError,
): Promise<{ holderId: string; blockedReason: string; autoBlocked: true }> {
  try {
    await autoBlockHolder(q, error.holderId, error.blockedReason, 'auto-block:issue-guard');
  } catch (writeErr) {
    log.error('Auto-block write failed after threshold trip',
      { holderId: error.holderId, writeErr }, 'field-stock');
  }
  return { holderId: error.holderId, blockedReason: error.blockedReason, autoBlocked: true };
}
