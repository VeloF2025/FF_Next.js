/**
 * OLT Lookup Queue Processor - Process pending 1Map API lookups from auto-detect queue.
 * POST: { runId?: number }
 * Status: WORKING | NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole } from '@/lib/auth';
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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const client = await pool.connect();

  try {
    const { runId } = req.body || {};

    // Fetch pending queue items
    const queueResult = await client.query(
      `SELECT id, drop_number, oes_serial, oes_batch_id, team
       FROM olt_onemap_lookup_queue
       WHERE status = 'pending' AND attempts < 3
       ORDER BY id
       LIMIT $1`,
      [BATCH_SIZE]
    );

    const items = queueResult.rows;
    if (items.length === 0) {
      // Queue empty - mark run as completed if runId provided
      if (runId) {
        await client.query(
          `UPDATE olt_auto_detect_runs
           SET status = 'completed', completed_at = NOW()
           WHERE id = $1 AND status = 'processing_queue'`,
          [runId]
        );
      }
      return apiResponse.success(res, { processed: 0, remaining: 0, message: 'Queue empty' });
    }

    log.info('OltQueueProcessor', `Processing ${items.length} queue items`);

    // Get import_id for the batch (created by auto-detect)
    const firstBatchId = items[0].oes_batch_id;
    const importRow = await client.query(
      `SELECT id FROM olt_report_imports
       WHERE filename LIKE $1
       ORDER BY imported_at DESC LIMIT 1`,
      [`Auto-detect: OES Batch ${firstBatchId.slice(0, 8)}%`]
    );
    const importId = importRow.rows[0]?.id;

    let processed = 0;
    let matchesFound = 0;
    let mismatchesCreated = 0;
    let notFoundCount = 0;
    let errorsCount = 0;

    for (const item of items) {
      try {
        // Mark as processing
        await client.query(
          `UPDATE olt_onemap_lookup_queue
           SET status = 'processing', attempts = attempts + 1
           WHERE id = $1`,
          [item.id]
        );

        // Search 1Map API
        const searchResult = await oneMapApi.searchDR(item.drop_number);

        if (!searchResult.success) {
          await client.query(
            `UPDATE olt_onemap_lookup_queue
             SET status = 'error', error_message = $1, processed_at = NOW()
             WHERE id = $2`,
            [searchResult.error || 'API search failed', item.id]
          );
          errorsCount++;
          continue;
        }

        if (searchResult.records.length === 0) {
          // DR genuinely not on 1Map - create Note 2 mismatch
          await client.query(
            `UPDATE olt_onemap_lookup_queue
             SET status = 'completed', mismatch_type = 'note2_not_on_1map',
                 processed_at = NOW()
             WHERE id = $1`,
            [item.id]
          );

          // Insert mismatch record (not_found = DR not in 1Map)
          if (importId) {
            await insertMismatchIfNew(client, {
              importId,
              dropNumber: item.drop_number,
              oltSerial: item.oes_serial,
              wrongOneMapSerial: null,
              fixStatus: 'not_found',
              hasUpsSwap: false,
              oesBatchId: item.oes_batch_id,
              oesSource: 'api',
            });
          }

          notFoundCount++;
          processed++;
          continue;
        }

        // DR found on 1Map - classify
        const record = searchResult.records[0];
        const oesSerial = item.oes_serial.trim().toUpperCase();
        const oneMapSerial = record.ph_ont?.trim().toUpperCase() || null;

        let mismatchType = 'match';
        let fixStatus = 'pending';
        let hasUpsSwap = false;

        if (!oneMapSerial) {
          mismatchType = 'note4_empty_barcode';
          fixStatus = 'pending';
        } else if (oesSerial === oneMapSerial) {
          mismatchType = 'match';
        } else {
          hasUpsSwap = isUpsSerial(oneMapSerial);
          mismatchType = hasUpsSwap ? 'note4_ups_swap' : 'note4_wrong_serial';
          fixStatus = 'pending';
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
            importId,
            dropNumber: item.drop_number,
            oltSerial: item.oes_serial,
            wrongOneMapSerial: record.ph_ont,
            fixStatus,
            hasUpsSwap,
            oesBatchId: item.oes_batch_id,
            oesSource: 'api',
          });
          mismatchesCreated++;
        } else {
          matchesFound++;
        }

        processed++;
      } catch (itemError) {
        log.error('OltQueueProcessor', `Failed to process queue item ${item.id}`, { itemError });
        await client.query(
          `UPDATE olt_onemap_lookup_queue
           SET status = 'pending', error_message = $1
           WHERE id = $2`,
          [itemError instanceof Error ? itemError.message : 'Unknown error', item.id]
        ).catch(() => { /* best effort */ });
        errorsCount++;
      }

      // Rate limit: delay between API calls
      if (processed < items.length) {
        await new Promise(resolve => setTimeout(resolve, API_DELAY_MS));
      }
    }

    // Check if more items remain
    const remainingResult = await client.query(
      `SELECT COUNT(*)::int AS remaining
       FROM olt_onemap_lookup_queue
       WHERE status = 'pending' AND attempts < 3`
    );
    const remaining = remainingResult.rows[0]?.remaining || 0;

    // If more items, continue processing via service (no HTTP self-invoke)
    if (remaining > 0) {
      import('@/modules/data-sync/services/oltQueueProcessorService')
        .then(({ processLookupQueue }) => processLookupQueue(runId))
        .catch(err => log.warn('OltQueueProcessor', 'Service continuation failed', err));
    } else if (runId) {
      // Queue fully processed - mark run complete
      await client.query(
        `UPDATE olt_auto_detect_runs
         SET status = 'completed', completed_at = NOW()
         WHERE id = $1 AND status = 'processing_queue'`,
        [runId]
      );
    }

    log.info('OltQueueProcessor', `Processed ${processed} items`, {
      matchesFound, mismatchesCreated, notFoundCount, errorsCount, remaining,
    });

    return apiResponse.success(res, {
      processed,
      matchesFound,
      mismatchesCreated,
      notFoundCount,
      errors: errorsCount,
      remaining,
    });
  } catch (error) {
    log.error('OltQueueProcessor', 'Queue processing failed', { error });
    return apiResponse.internalError(res, error);
  } finally {
    client.release();
  }
}

/**
 * Insert a mismatch record with duplicate checking.
 */
async function insertMismatchIfNew(
  client: ReturnType<Pool['connect']> extends Promise<infer T> ? T : never,
  data: {
    importId: string;
    dropNumber: string;
    oltSerial: string;
    wrongOneMapSerial: string | null;
    fixStatus: string;
    hasUpsSwap: boolean;
    oesBatchId: string;
    oesSource: string;
  }
): Promise<void> {
  const existing = await client.query(
    `SELECT id, fix_status, olt_serial
     FROM olt_mismatch_records
     WHERE drop_number = $1
     ORDER BY created_at DESC LIMIT 1`,
    [data.dropNumber]
  );

  if (existing.rows.length > 0) {
    const ex = existing.rows[0];
    if (ex.fix_status === 'fixed' && ex.olt_serial?.toUpperCase() === data.oltSerial.toUpperCase()) {
      return; // Already fixed with same serial
    }
    if (ex.fix_status === 'pending' || ex.fix_status === 'empty_serial') {
      // Update existing pending
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

export default withAuth(withRole('manager')(handler));
