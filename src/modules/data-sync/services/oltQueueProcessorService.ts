/**
 * OLT Lookup Queue Processor Service
 *
 * Processes pending 1Map API lookups from the auto-detect queue.
 * Called directly (no HTTP) to avoid auth issues with fire-and-forget.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { Pool } from 'pg';
import { log } from '@/lib/logger';
import { oneMapApi } from '@/modules/system/services/oneMapApiService';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const BATCH_SIZE = 50;
const API_DELAY_MS = 100;

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
      for (const item of items) {
        try {
          await client.query(
            `UPDATE olt_onemap_lookup_queue
             SET status = 'processing', attempts = attempts + 1
             WHERE id = $1`,
            [item.id]
          );

          const searchResult = await oneMapApi.searchDR(item.drop_number);

          if (!searchResult.success) {
            await client.query(
              `UPDATE olt_onemap_lookup_queue
               SET status = 'error', error_message = $1, processed_at = NOW()
               WHERE id = $2`,
              [searchResult.error || 'API search failed', item.id]
            );
            continue;
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
            processed++;
            continue;
          }

          const record = searchResult.records[0];
          const oesSerial = item.oes_serial.trim().toUpperCase();
          const oneMapSerial = record.ph_ont?.trim().toUpperCase() || null;

          let mismatchType = 'match';
          let fixStatus = 'pending';
          let hasUpsSwap = false;

          if (!oneMapSerial) {
            mismatchType = 'note4_empty_barcode';
          } else if (oesSerial === oneMapSerial) {
            mismatchType = 'match';
          } else {
            hasUpsSwap = isUpsSerial(oneMapSerial);
            mismatchType = hasUpsSwap ? 'note4_ups_swap' : 'note4_wrong_serial';
          }

          await client.query(
            `UPDATE olt_onemap_lookup_queue
             SET status = 'completed', onemap_serial = $1, onemap_ups_serial = $2,
                 mismatch_type = $3, processed_at = NOW()
             WHERE id = $4`,
            [record.ph_ont, record.br_ser, mismatchType, item.id]
          );

          if (mismatchType !== 'match' && importId) {
            await insertMismatchIfNew(client, {
              importId, dropNumber: item.drop_number,
              oltSerial: item.oes_serial,
              wrongOneMapSerial: record.ph_ont,
              fixStatus, hasUpsSwap,
              oesBatchId: item.oes_batch_id, oesSource: 'api',
            });
          }
          processed++;
        } catch (itemError) {
          log.error('OltQueueProcessor', `Item ${item.id} failed`, { itemError });
          await client.query(
            `UPDATE olt_onemap_lookup_queue
             SET status = 'pending', error_message = $1 WHERE id = $2`,
            [itemError instanceof Error ? itemError.message : 'Unknown', item.id]
          ).catch(() => {});
        }

        if (processed < items.length) {
          await new Promise(r => setTimeout(r, API_DELAY_MS));
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

async function insertMismatchIfNew(
  client: ReturnType<Pool['connect']> extends Promise<infer T> ? T : never,
  data: {
    importId: string; dropNumber: string; oltSerial: string;
    wrongOneMapSerial: string | null; fixStatus: string;
    hasUpsSwap: boolean; oesBatchId: string; oesSource: string;
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
             oes_batch_id = $4, onemap_source = $5
         WHERE id = $6`,
        [data.oltSerial, data.wrongOneMapSerial, data.hasUpsSwap,
         data.oesBatchId, data.oesSource, ex.id]
      );
      return;
    }
  }

  await client.query(
    `INSERT INTO olt_mismatch_records
      (import_id, drop_number, olt_serial, wrong_onemap_serial, fix_status,
       has_ups_swap, detection_source, oes_batch_id, onemap_source)
     VALUES ($1, $2, $3, $4, $5, $6, 'auto', $7, $8)`,
    [data.importId, data.dropNumber, data.oltSerial, data.wrongOneMapSerial,
     data.fixStatus, data.hasUpsSwap, data.oesBatchId, data.oesSource]
  );
}
