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

function isUpsSerial(serial: string | null): boolean {
  return !!serial && serial.toUpperCase().startsWith('GU18');
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

    const mismatchType = otherDr ? 'note2_serial_other_dr' : 'note2_not_on_1map';
    await client.query(
      `UPDATE olt_onemap_lookup_queue
       SET status = 'completed', mismatch_type = $1, processed_at = NOW()
       WHERE id = $2`,
      [mismatchType, item.id]
    );
    if (importId) {
      await insertMismatchIfNew(client, {
        importId, dropNumber: item.drop_number,
        oltSerial: item.oes_serial,
        wrongOneMapSerial: null,
        fixStatus: otherDr ? 'serial_other_dr' : 'not_found',
        hasUpsSwap: false,
        oesBatchId: item.oes_batch_id, oesSource: 'api',
        investigationContext: otherDr?.context ?? null,
      });
    }
    return;
  }

  const oesSerial = item.oes_serial.trim().toUpperCase();
  const records = searchResult.records;
  let correctCount = 0, emptyCount = 0, wrongCount = 0, swapCount = 0;
  let firstWrongSerial: string | null = null;
  let firstUpsSerial: string | null = null;

  for (const rec of records) {
    const ont = rec.ph_ont?.trim().toUpperCase() || null;
    const ups = rec.br_ser?.trim().toUpperCase() || null;
    if (ont === oesSerial) { correctCount++; }
    else if (!ont) { emptyCount++; }
    else if (ups === oesSerial && isUpsSerial(ont)) {
      swapCount++;
      if (!firstWrongSerial) { firstWrongSerial = rec.ph_ont; firstUpsSerial = rec.br_ser; }
    } else {
      wrongCount++;
      if (!firstWrongSerial) { firstWrongSerial = rec.ph_ont; firstUpsSerial = rec.br_ser; }
    }
  }

  let mismatchType = 'match';
  let fixStatus = 'pending';
  let hasUpsSwap = false;
  if (swapCount > 0) { mismatchType = 'note4_ups_swap'; hasUpsSwap = true; }
  else if (wrongCount > 0) { mismatchType = 'note4_wrong_serial'; }
  else if (emptyCount > 0 && correctCount === 0) { mismatchType = 'note4_empty_barcode'; }

  const bestRecord = (records.find(r => r.ph_ont) || records[0])!;
  await client.query(
    `UPDATE olt_onemap_lookup_queue
     SET status = 'completed', onemap_serial = $1, onemap_ups_serial = $2,
         mismatch_type = $3, processed_at = NOW()
     WHERE id = $4`,
    [bestRecord.ph_ont, bestRecord.br_ser, mismatchType, item.id]
  );

  let investigationContext: string | null = null;
  if ((wrongCount > 0 || swapCount > 0) && firstWrongSerial) {
    const ownerLookup = await client.query(
      `SELECT drop_number, serial_number, team, status
       FROM oes_activations
       WHERE UPPER(serial_number) = $1
       ORDER BY created_at DESC LIMIT 1`,
      [firstWrongSerial.toUpperCase()]
    );
    if (ownerLookup.rows.length > 0) {
      const owner = ownerLookup.rows[0];
      if (owner.drop_number !== item.drop_number) {
        fixStatus = 'needs_investigation';
        investigationContext = JSON.stringify({
          reason: 'cross_dr_conflict',
          wrongSerial: firstWrongSerial,
          wrongUps: firstUpsSerial,
          belongsToDr: owner.drop_number,
          belongsToTeam: owner.team,
          belongsToStatus: owner.status,
          totalPropRecords: records.length,
          correctRecords: correctCount,
          wrongRecords: wrongCount,
          swappedRecords: swapCount,
          message: `ONT ${firstWrongSerial} on 1Map belongs to ${owner.drop_number} (${owner.team}). Cannot auto-fix without losing equipment tracking.`,
        });
      }
    }
  }

  if (mismatchType !== 'match' && importId) {
    await insertMismatchIfNew(client, {
      importId, dropNumber: item.drop_number,
      oltSerial: item.oes_serial,
      wrongOneMapSerial: firstWrongSerial || bestRecord.ph_ont,
      fixStatus, hasUpsSwap,
      oesBatchId: item.oes_batch_id, oesSource: 'api',
      investigationContext,
    });
  } else if (mismatchType === 'match') {
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

