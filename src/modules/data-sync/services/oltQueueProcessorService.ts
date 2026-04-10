/**
 * OLT Lookup Queue Processor Service
 *
 * Processes pending 1Map API lookups from the auto-detect queue.
 * Called directly (no HTTP) to avoid auth issues with fire-and-forget.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { oneMapApi } from '@/modules/system/services/oneMapApiService';

const BATCH_SIZE = 50;
const CONCURRENCY = 3;
const STAGGER_MS = 150;

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

      const queueResult = await client.query(
        `SELECT id, drop_number, oes_serial, oes_batch_id, team
         FROM olt_onemap_lookup_queue
         WHERE status = 'pending' AND attempts < 3
         ORDER BY id LIMIT $1`,
        [BATCH_SIZE]
      );

      const items = queueResult.rows;
      if (items.length === 0) {
        if (runId) {
          await client.query(
            `UPDATE olt_auto_detect_runs
             SET status = 'completed', completed_at = NOW()
             WHERE id = $1 AND status = 'processing_queue'`,
            [runId]
          );
        }
        log.info('OltQueueProcessor', `Queue empty after ${totalProcessed} items`);
        return;
      }

      // Get import_id for linking mismatch records
      const firstBatchId = items[0].oes_batch_id;
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
      log.info('OltQueueProcessor', `Batch done: ${processed} items, total: ${totalProcessed}`);
    } finally {
      client.release();
    }
  }

  log.warn('OltQueueProcessor', `Hit max iterations (${MAX_ITERATIONS})`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processOneItem(client: any, item: any, importId: string | undefined): Promise<void> {
  await client.query(
    `UPDATE olt_onemap_lookup_queue
     SET status = 'processing', attempts = attempts + 1
     WHERE id = $1`,
    [item.id]
  );

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
    await client.query(
      `UPDATE olt_onemap_lookup_queue
       SET status = 'completed', mismatch_type = 'note2_not_on_1map',
           processed_at = NOW()
       WHERE id = $1`,
      [item.id]
    );
    if (importId) {
      await insertMismatchIfNew(client, {
        importId, dropNumber: item.drop_number,
        oltSerial: item.oes_serial, wrongOneMapSerial: null,
        fixStatus: 'not_found', hasUpsSwap: false,
        oesBatchId: item.oes_batch_id, oesSource: 'api',
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
  }
}

async function insertMismatchIfNew(
  client: ReturnType<Pool['connect']> extends Promise<infer T> ? T : never,
  data: {
    importId: string; dropNumber: string; oltSerial: string;
    wrongOneMapSerial: string | null; fixStatus: string;
    hasUpsSwap: boolean; oesBatchId: string; oesSource: string;
    investigationContext?: string | null;
  }
): Promise<void> {
  const existing = await client.query(
    `SELECT id, fix_status, olt_serial FROM olt_mismatch_records
     WHERE drop_number = $1 ORDER BY created_at DESC LIMIT 1`,
    [data.dropNumber]
  );

  if (existing.rows.length > 0) {
    const ex = existing.rows[0];
    if (ex.fix_status === 'fixed'
        && ex.olt_serial?.toUpperCase() === data.oltSerial.toUpperCase()) {
      return;
    }
    if (['pending', 'empty_serial', 'not_found'].includes(ex.fix_status)) {
      await client.query(
        `UPDATE olt_mismatch_records
         SET olt_serial = $1, wrong_onemap_serial = $2,
             has_ups_swap = $3, detection_source = 'auto',
             oes_batch_id = $4, onemap_source = $5,
             fix_status = $6, investigation_context = $7
         WHERE id = $8`,
        [data.oltSerial, data.wrongOneMapSerial, data.hasUpsSwap,
         data.oesBatchId, data.oesSource, data.fixStatus,
         data.investigationContext || null, ex.id]
      );
      return;
    }
  }

  await client.query(
    `INSERT INTO olt_mismatch_records
      (import_id, drop_number, olt_serial, wrong_onemap_serial, fix_status,
       has_ups_swap, detection_source, oes_batch_id, onemap_source, investigation_context)
     VALUES ($1, $2, $3, $4, $5, $6, 'auto', $7, $8, $9)`,
    [data.importId, data.dropNumber, data.oltSerial, data.wrongOneMapSerial,
     data.fixStatus, data.hasUpsSwap, data.oesBatchId, data.oesSource,
     data.investigationContext || null]
  );
}
