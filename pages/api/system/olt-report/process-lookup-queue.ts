/**
 * OLT Lookup Queue Processor - Process pending 1Map API lookups from auto-detect queue.
 * POST: { runId?: number }
 * Status: WORKING | NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import type { PoolClient } from 'pg';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole } from '@/lib/auth';
import { log } from '@/lib/logger';
import { oneMapApi } from '@/modules/system/services/oneMapApiService';
import {
  findSerialOnOtherDr,
  type QueueItem,
} from '@/modules/data-sync/services/oltQueueProcessorService';
import {
  classifyEmptyRecords,
  classifyOltRecords,
  findCrossDrOwner,
  buildCrossDrContext,
} from '@/modules/data-sync/services/oltMismatchClassifier';
import { insertMismatchIfNew } from '@/modules/data-sync/services/oltMismatchUpsert';

const BATCH_SIZE = 50;
const CONCURRENCY = 2; // Reduced from 3 - fewer concurrent 1Map calls = faster individual responses
const STAGGER_MS = 500; // Increased stagger to avoid overwhelming 1Map

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const client = await pool.connect();

  try {
    const { runId } = req.body || {};

    // Atomically claim pending items: locks the rows and flips them to 'processing'
    // in a single statement so concurrent workers never see the same id twice.
    const queueResult = await client.query(
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

    log.info(`Processing ${items.length} queue items`, undefined, 'OltQueueProcessor');

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
        .catch(err => log.warn('Service continuation failed', { error: err }, 'OltQueueProcessor'));
    } else if (runId) {
      // Queue fully processed - mark run complete
      await client.query(
        `UPDATE olt_auto_detect_runs
         SET status = 'completed', completed_at = NOW()
         WHERE id = $1 AND status = 'processing_queue'`,
        [runId]
      );
    }

    log.info(`Processed ${processed} items (${CONCURRENCY} concurrent)`, {
      errorsCount, remaining,
    }, 'OltQueueProcessor');

    return apiResponse.success(res, {
      processed,
      errors: errorsCount,
      remaining,
    });
  } catch (error) {
    log.error('Queue processing failed', { error }, 'OltQueueProcessor');
    return apiResponse.internalError(res, error);
  } finally {
    client.release();
  }
}

async function processOneQueueItem(client: PoolClient, item: QueueItem, importId: string | undefined): Promise<void> {
  // Item was already atomically claimed (status='processing', attempts incremented)
  // by the batch SELECT in the handler, so no pre-flight UPDATE is needed here.
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
    // DR absent from 1Map. Reverse-lookup the serial: if it's installed under a
    // different drop, classify serial_other_dr instead of a blind not_found.
    // Shares the service's helper so both queue-processing paths stay in sync.
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
        oltSerial: item.oes_serial, wrongOneMapSerial: null,
        fixStatus: empty.fixStatus, hasUpsSwap: false,
        oesBatchId: item.oes_batch_id, oesSource: 'api',
        investigationContext: empty.investigationContext,
      });
    }
    return;
  }

  // Shared classifier — the single source of truth for the mismatch verdict
  // (incl. status_mismatch), so this inline path and the continuation service
  // can never drift.
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
  }
  // NOTE: deliberate asymmetry — unlike the continuation service's processOneItem,
  // this inline path has NO match-branch auto-resolve of stale mismatch rows. That
  // is a queue side-effect, out of scope for this classification-only unification
  // (activations audit rec #4). Classification is now shared; the match-resolution
  // side-effect is the one remaining divergence, left for a follow-up so this PR
  // changes no side-effects.
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
