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
const CONCURRENCY = 2; // Reduced from 3 - fewer concurrent 1Map calls = faster individual responses
const STAGGER_MS = 500; // Increased stagger to avoid overwhelming 1Map

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
    let errorsCount = 0;

    // Process items in concurrent chunks for speed
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const chunk = items.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map((item, idx) =>
          new Promise(r => setTimeout(r, idx * STAGGER_MS)).then(() =>
            processOneQueueItem(client, item, importId)
          )
        )
      );
      for (const r of results) {
        if (r.status === 'fulfilled') processed++;
        else errorsCount++;
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

    log.info('OltQueueProcessor', `Processed ${processed} items (${CONCURRENCY} concurrent)`, {
      errorsCount, remaining,
    });

    return apiResponse.success(res, {
      processed,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processOneQueueItem(client: any, item: any, importId: string | undefined): Promise<void> {
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

  // Status mismatch check: serial is correct but status is wrong
  const INSTALLED_STATUS = 'Home Installation: Installed';
  let statusMismatchContext: string | null = null;
  if (mismatchType === 'match' && correctCount > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrongStatusRecord = records.find((r: any) =>
      r.ph_ont?.trim().toUpperCase() === oesSerial && r.status !== INSTALLED_STATUS
    );
    if (wrongStatusRecord) {
      mismatchType = 'status_mismatch';
      statusMismatchContext = JSON.stringify({
        reason: 'status_mismatch',
        propId: wrongStatusRecord.prop_id,
        currentStatus: wrongStatusRecord.status || 'unknown',
        expectedStatus: INSTALLED_STATUS,
        message: `Status is "${wrongStatusRecord.status || 'unknown'}" but should be "${INSTALLED_STATUS}"`,
      });
    }
  }

  const bestRecord = records.find(r => r.ph_ont) || records[0];
  await client.query(
    `UPDATE olt_onemap_lookup_queue
     SET status = 'completed', onemap_serial = $1, onemap_ups_serial = $2,
         mismatch_type = $3, processed_at = NOW()
     WHERE id = $4`,
    [bestRecord.ph_ont, bestRecord.br_ser, mismatchType, item.id]
  );

  let investigationContext: string | null = statusMismatchContext;
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
      wrongOneMapSerial: mismatchType === 'status_mismatch' ? null : (firstWrongSerial || bestRecord.ph_ont),
      fixStatus, hasUpsSwap,
      oesBatchId: item.oes_batch_id, oesSource: 'api',
      investigationContext,
    });
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
    investigationContext?: string | null;
  }
): Promise<void> {
  const isNewStatusMismatch = data.investigationContext
    ? (() => { try { return JSON.parse(data.investigationContext!).reason === 'status_mismatch'; } catch { return false; } })()
    : false;

  const existing = await client.query(
    `SELECT id, fix_status, olt_serial, investigation_context
     FROM olt_mismatch_records
     WHERE drop_number = $1
     ORDER BY created_at DESC LIMIT 1`,
    [data.dropNumber]
  );

  if (existing.rows.length > 0) {
    const ex = existing.rows[0];
    const exContext = ex.investigation_context
      ? (typeof ex.investigation_context === 'string' ? (() => { try { return JSON.parse(ex.investigation_context); } catch { return null; } })() : ex.investigation_context)
      : null;
    const isExistingStatusMismatch = exContext?.reason === 'status_mismatch';

    if (ex.fix_status === 'fixed' && ex.olt_serial?.toUpperCase() === data.oltSerial.toUpperCase()) {
      // If existing was a serial fix and new issue is a status mismatch, allow creation
      if (isNewStatusMismatch && !isExistingStatusMismatch) {
        // Fall through to INSERT - serial was fixed, now status needs fixing
      } else {
        return; // Already fixed with same serial (or same status mismatch already fixed)
      }
    } else if (ex.fix_status === 'pending' || ex.fix_status === 'empty_serial'
        || ex.fix_status === 'not_found') {
      // Don't overwrite a pending serial fix with a status mismatch
      if (isNewStatusMismatch && !isExistingStatusMismatch) {
        return; // Serial fix takes priority, don't overwrite
      }
      // Update existing pending
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

// Allow internal trigger via API key (for server-side fire-and-forget after restarts)
function withInternalKey(wrapped: typeof handler) {
  return (req: NextApiRequest, res: NextApiResponse) => {
    if (req.headers['x-internal-key'] === 'olt-queue-processor-2026') {
      return wrapped(req, res);
    }
    return withAuth(withRole('manager')(wrapped))(req, res);
  };
}

export default withInternalKey(handler);
