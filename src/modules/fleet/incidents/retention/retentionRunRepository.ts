/**
 * Durable run and per-item state for the retention pipeline (migration 518).
 *
 * Split out of `retentionRepository.ts` on size: that file now covers only
 * SELECTION — which incidents are eligible, whether their month is covered,
 * and whether one is still purgeable — while this covers the RECORD of what a
 * run did to them. The two are read by different halves of the service and
 * neither imports the other.
 *
 * Every write here is an UPDATE on a row that still names an incident, which
 * means `trg_fleet_retention_item_guard` can refuse ANY of them the moment a
 * hold lands (23514) — including the ones that would record a failure. See
 * `retentionService.processItem`, which treats that refusal as a skip rather
 * than routing it into the failure path it cannot use.
 */
import { query, queryOne, type TxnClient } from '@/lib/db-pool';
import type { RetentionItem, RetentionItemStage, RunStatus } from '../analytics/types';

interface IdRow extends Record<string, unknown> { id: string }

export interface RetentionRunTotals {
  status: RunStatus;
  itemsConsidered: number;
  itemsClaimed: number;
  itemsCompleted: number;
  itemsFailed: number;
  itemsSkippedHold: number;
  itemsSkippedCoverage: number;
  storageObjectsDeleted: number;
  errorCode: string | null;
}

interface IdRow extends Record<string, unknown> { id: string }

export async function insertRetentionRun(params: {
  dryRun: boolean; cutoffWorkDate: string; policyMonths: number; triggerSource: 'cron' | 'manual';
}): Promise<string> {
  const row = await queryOne<IdRow>(
    `/* fleet-retention:run-start */
     INSERT INTO fleet_operational_retention_runs (dry_run, cutoff_work_date, policy_months, trigger_source)
     VALUES ($1, $2::date, $3::int, $4) RETURNING id`,
    [params.dryRun, params.cutoffWorkDate, params.policyMonths, params.triggerSource],
  );
  if (!row) throw new Error('Retention run insert returned no row');
  return row.id;
}

export async function finalizeRetentionRun(runId: string, totals: RetentionRunTotals): Promise<void> {
  await query(
    `/* fleet-retention:run-finish */
     UPDATE fleet_operational_retention_runs
        SET status = $2, finished_at = now(), items_considered = $3, items_claimed = $4,
            items_completed = $5, items_failed = $6, items_skipped_hold = $7,
            items_skipped_coverage = $8, storage_objects_deleted = $9, error_code = $10
      WHERE id = $1::uuid`,
    [
      runId, totals.status, totals.itemsConsidered, totals.itemsClaimed, totals.itemsCompleted,
      totals.itemsFailed, totals.itemsSkippedHold, totals.itemsSkippedCoverage,
      totals.storageObjectsDeleted, totals.errorCode,
    ],
  );
}

const ITEM_COLUMNS = `id, retention_run_id, incident_id, stage, storage_objects_total,
  storage_objects_deleted, attempts, last_error_code`;

interface ItemRow extends Record<string, unknown> {
  id: string; retention_run_id: string; incident_id: string | null; stage: RetentionItemStage;
  storage_objects_total: number; storage_objects_deleted: number; attempts: number; last_error_code: string | null;
}

function mapItem(row: ItemRow): RetentionItem {
  return {
    id: row.id, retentionRunId: row.retention_run_id, incidentId: row.incident_id, stage: row.stage,
    storageObjectsTotal: row.storage_objects_total, storageObjectsDeleted: row.storage_objects_deleted,
    attempts: row.attempts, lastErrorCode: row.last_error_code,
  };
}

/**
 * Claims one incident for this run. The insert trips
 * `trg_fleet_retention_item_guard` (terminal state, no active hold) and the
 * `ux_fleet_operational_retention_items_live` unique index (no second claim),
 * so a lost race raises rather than double-purging.
 */
export async function claimIncident(
  txn: TxnClient, params: { runId: string; incidentId: string; storageObjectsTotal: number },
): Promise<RetentionItem> {
  const row = await txn.queryOne<ItemRow>(
    `/* fleet-retention:claim */
     INSERT INTO fleet_operational_retention_items
       (retention_run_id, incident_id, stage, storage_objects_total, attempts)
     VALUES ($1::uuid, $2::uuid, 'pending_storage', $3::int, 1)
     RETURNING ${ITEM_COLUMNS}`,
    [params.runId, params.incidentId, params.storageObjectsTotal],
  );
  if (!row) throw new Error('Retention item claim returned no row');
  return mapItem(row);
}

/**
 * One more object accounted for. Called per object so a crash mid-batch loses
 * at most the current one.
 *
 * The `< storage_objects_total` guard keeps the counter inside the table's
 * CHECK, but on its own it turns an overflow into a no-op: the UPDATE matches
 * nothing, no trigger fires, and a loop over an evidence set that GREW after
 * the claim would keep deleting files unguarded. Matching no row is therefore
 * an error, not a silent success — the caller stops, and the mismatch is
 * visible instead of costing files.
 */
export async function recordStorageObjectDeleted(itemId: string): Promise<void> {
  const rows = await query<IdRow>(
    `/* fleet-retention:storage-progress */
     UPDATE fleet_operational_retention_items
        SET storage_objects_deleted = storage_objects_deleted + 1, updated_at = now()
      WHERE id = $1::uuid AND storage_objects_deleted < storage_objects_total
      RETURNING id`,
    [itemId],
  );
  if (rows.length === 0) {
    throw new Error(
      `Retention item ${itemId}: storage object count exceeded the total recorded at claim time — the evidence set changed under the run`,
    );
  }
}

export async function markStorageComplete(itemId: string): Promise<void> {
  await query(
    `/* fleet-retention:storage-complete */
     UPDATE fleet_operational_retention_items
        SET stage = 'storage_complete', last_error_code = NULL, updated_at = now()
      WHERE id = $1::uuid`,
    [itemId],
  );
}

/** Records a failure WITHOUT touching the incident's records — they stay for the retry. */
export async function markItemFailed(itemId: string, errorCode: string): Promise<void> {
  await query(
    `/* fleet-retention:item-failed */
     UPDATE fleet_operational_retention_items
        SET stage = 'failed', last_error_code = $2, updated_at = now()
      WHERE id = $1::uuid`,
    [itemId, errorCode.slice(0, 100)],
  );
}

export async function recordItemAttempt(itemId: string): Promise<void> {
  await query(
    `/* fleet-retention:item-attempt */
     UPDATE fleet_operational_retention_items SET attempts = attempts + 1, updated_at = now() WHERE id = $1::uuid`,
    [itemId],
  );
}

/** Items from earlier runs that still hold an identity: resumed from their durable stage before new work is claimed. */
export async function listResumableItems(limit: number): Promise<RetentionItem[]> {
  const rows = await query<ItemRow>(
    `/* fleet-retention:resumable */
     SELECT ${ITEM_COLUMNS} FROM fleet_operational_retention_items
      WHERE incident_id IS NOT NULL AND stage IN ('claimed', 'pending_storage', 'storage_complete', 'failed')
      ORDER BY claimed_at ASC LIMIT $1::int`,
    [limit],
  );
  return rows.map(mapItem);
}

export async function getItem(itemId: string): Promise<RetentionItem | null> {
  const row = await queryOne<ItemRow>(
    `/* fleet-retention:item */ SELECT ${ITEM_COLUMNS} FROM fleet_operational_retention_items WHERE id = $1::uuid`,
    [itemId],
  );
  return row ? mapItem(row) : null;
}
