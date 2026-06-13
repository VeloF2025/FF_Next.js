/**
 * OLT Lookup Queue Processor Service
 *
 * Processes pending 1Map API lookups from the auto-detect queue.
 * Called directly (no HTTP) to avoid auth issues with fire-and-forget.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';

const log = createLogger('OltQueueProcessor');
import { oneMapApi } from '@/modules/system/services/oneMapApiService';
import { findSerialOnOtherDr } from './oltSerialReverseLookup';
import { insertMismatchIfNew } from './oltMismatchUpsert';
import {
  classifyEmptyRecords,
  classifyOltRecords,
  findCrossDrOwner,
  buildCrossDrContext,
} from './oltMismatchClassifier';

// Re-exported so existing importers (queue endpoint, backfill scripts) keep
// resolving it from this module after the helper moved to its own file.
export { findSerialOnOtherDr };

const BATCH_SIZE = 50;
const CONCURRENCY = 3;
const STAGGER_MS = 150;

export interface QueueItem {
  id: number;
  drop_number: string;
  oes_serial: string;
  oes_batch_id: string;
  team: string;
}

/**
 * Process all pending queue items in batches.
 * Runs until queue is empty or max iterations reached.
 */
export async function processLookupQueue(runId?: number): Promise<void> {
  let totalProcessed = 0;
  let iterations = 0;
  const MAX_ITERATIONS = 200; // Safety: 200 * 50 = 10,000 items max

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const client = await pool.connect();

    try {
      // Reset errored items with retries remaining back to pending
      await client.query(
        `UPDATE olt_onemap_lookup_queue
         SET status = 'pending'
         WHERE status = 'error' AND attempts < 3`
      );

      // Atomically claim pending items: locks and flips to 'processing' in one
      // statement so concurrent workers can't claim the same row twice.
      const queueResult = await client.query<QueueItem>(
        `UPDATE olt_onemap_lookup_queue
         SET status = 'processing', attempts = attempts + 1
         WHERE id IN (
           SELECT id FROM olt_onemap_lookup_queue
           WHERE status = 'pending' AND attempts < 3
           ORDER BY id
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING id, drop_number, oes_serial, oes_batch_id, team`,
        [BATCH_SIZE]
      );

      const items: QueueItem[] = queueResult.rows;
      if (items.length === 0) {
        if (runId) {
          await client.query(
            `UPDATE olt_auto_detect_runs
             SET status = 'completed', completed_at = NOW()
             WHERE id = $1 AND status = 'processing_queue'`,
            [runId]
          );
        }
        log.info(`Queue empty after ${totalProcessed} items`);
        return;
      }

      // Get import_id for linking mismatch records (items.length > 0 guaranteed above)
      const firstBatchId = items[0]!.oes_batch_id;
      const importRow = await client.query(
        `SELECT id FROM olt_report_imports
         WHERE filename LIKE $1
         ORDER BY imported_at DESC LIMIT 1`,
        [`Auto-detect: OES Batch ${firstBatchId.slice(0, 8)}%`]
      );
      const importId = importRow.rows[0]?.id;

      let processed = 0;

      // Process items in concurrent chunks for speed
      for (let i = 0; i < items.length; i += CONCURRENCY) {
        const chunk = items.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          chunk.map((item, idx) =>
            // Stagger starts within chunk to avoid burst
            new Promise(r => setTimeout(r, idx * STAGGER_MS)).then(() =>
              processOneItem(client, item, importId)
            )
          )
        );
        for (const r of results) {
          if (r.status === 'fulfilled') processed++;
        }
      }

      totalProcessed += processed;
      log.info(`Batch done: ${processed} items, total: ${totalProcessed}`);
    } finally {
      client.release();
    }
  }

  log.warn(`Hit max iterations (${MAX_ITERATIONS})`);
}

export async function processOneItem(client: PoolClient, item: QueueItem, importId: string | undefined): Promise<void> {
  // Item was already atomically claimed (status='processing', attempts incremented)
  // by the batch SELECT in processLookupQueue, so no pre-flight UPDATE is needed.
  let searchResult;
  try {
    searchResult = await oneMapApi.searchDR(item.drop_number);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await client.query(
      `UPDATE olt_onemap_lookup_queue
       SET status = 'error', error_message = $1, processed_at = NOW()
       WHERE id = $2`,
      [msg, item.id]
    );
    throw err;
  }

  if (!searchResult.success) {
    await client.query(
      `UPDATE olt_onemap_lookup_queue
       SET status = 'error', error_message = $1, processed_at = NOW()
       WHERE id = $2`,
      [searchResult.error || 'API search failed', item.id]
    );
    throw new Error(searchResult.error || 'API search failed');
  }

  if (searchResult.records.length === 0) {
    // DR is absent from 1Map. Before settling on 'not_found', reverse-lookup the
    // OES serial: if the unit IS on 1Map under a different drop, the serial is
    // right and only the drop linkage is wrong — a distinct, actionable verdict.
    const otherDr = await findSerialOnOtherDr(client, item);
    const empty = classifyEmptyRecords(otherDr);
    await client.query(
      `UPDATE olt_onemap_lookup_queue
       SET status = 'completed', mismatch_type = $1, processed_at = NOW()
       WHERE id = $2`,
      [empty.mismatchType, item.id]
    );
    if (importId) {
      await insertMismatchIfNew(client, {
        importId, dropNumber: item.drop_number,
        oltSerial: item.oes_serial,
        wrongOneMapSerial: null,
        fixStatus: empty.fixStatus,
        hasUpsSwap: false,
        oesBatchId: item.oes_batch_id, oesSource: 'api',
        investigationContext: empty.investigationContext,
      });
    }
    return;
  }

  // Shared classifier — the single source of truth for the mismatch verdict, so
  // the service and the inline endpoint processor can never drift.
  const cls = classifyOltRecords(item.oes_serial, searchResult.records);
  await client.query(
    `UPDATE olt_onemap_lookup_queue
     SET status = 'completed', onemap_serial = $1, onemap_ups_serial = $2,
         mismatch_type = $3, processed_at = NOW()
     WHERE id = $4`,
    [cls.bestRecord.ph_ont, cls.bestRecord.br_ser, cls.mismatchType, item.id]
  );

  let fixStatus = cls.fixStatus;
  let investigationContext = cls.investigationContext;
  if ((cls.wrongCount > 0 || cls.swapCount > 0) && cls.firstWrongSerial) {
    const owner = await findCrossDrOwner(client, cls.firstWrongSerial);
    const crossDr = buildCrossDrContext(cls, owner, item.drop_number);
    if (crossDr) {
      fixStatus = crossDr.fixStatus;
      investigationContext = crossDr.investigationContext;
    }
  }

  if (cls.mismatchType !== 'match' && importId) {
    await insertMismatchIfNew(client, {
      importId, dropNumber: item.drop_number,
      oltSerial: item.oes_serial,
      wrongOneMapSerial: cls.wrongOneMapSerial,
      fixStatus, hasUpsSwap: cls.hasUpsSwap,
      oesBatchId: item.oes_batch_id, oesSource: 'api',
      investigationContext,
    });
  } else if (cls.mismatchType === 'match') {
    // The OES serial now matches 1Map. If an earlier run left an auto-detected
    // record for this drop (e.g. a stale 'not_found' from before 1Map caught
    // up), it is reconciled — resolve it so it drops out of the investigate /
    // non-invoiceable lists instead of lingering forever. No-op when no such row.
    // Deliberately scoped:
    //  - only auto-detected states (NOT needs_investigation / needs_reinvestigation):
    //    those are human-review verdicts and must not be silently auto-closed.
    //  - skip rows with an open ticket: NOC owns that lifecycle.
    await client.query(
      `UPDATE olt_mismatch_records
       SET fix_status = 'resolved',
           resolution_type = 'auto_verified_match',
           resolution_notes = 'Auto-resolved: OES serial now matches 1Map on re-check',
           resolved_at = NOW()
       WHERE drop_number = $1
         AND maintenance_ticket_id IS NULL
         AND fix_status IN ('pending','not_found','empty_serial','serial_other_dr')`,
      [item.drop_number]
    );
  }
}

