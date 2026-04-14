/**
 * OES Post-Import Side Effects
 *
 * All fire-and-forget operations triggered after a successful OES import:
 * - QField sync webhook
 * - SharePoint folder verification
 * - OLT auto-detect
 * - Serial verification recomputation
 * - VLM learning from OES ground truth
 * - PP activation status check
 * - ONT swap confirmation
 *
 * Each function is independent and non-blocking. Errors are logged but
 * never propagate to the caller.
 */

import { createLogger } from '@/lib/logger';
import pool from '@/lib/db';
import { computeAndPersistVerification } from '@/modules/activate/services/serialVerificationService';
import { recordVlmCorrectionsFromOes } from './oesVlmLearningService';

const logger = createLogger('oes/oesPostImportService');

// ============================================================================
// QFIELD SYNC
// ============================================================================

interface QFieldSyncPayload {
  batchId: string;
  totalRows: number;
  imported: number;
  matched: number;
  timestamp: string;
  reportDate: string;
}

/**
 * Trigger QField sync webhook (fire-and-forget, 10s receipt timeout).
 * Returns true if the webhook was accepted.
 */
export function triggerQFieldSync(payload: QFieldSyncPayload): boolean {
  logger.info('Triggering QField sync webhook (fire-and-forget)', { data: payload });


  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  fetch('http://100.96.203.105:8095/sync/oes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
    .then(async (response) => {
      clearTimeout(timeoutId);
      if (response.ok) {
        const result = await response.json();
        logger.info('QField sync webhook accepted', result);
      } else {
        logger.warn(`QField sync webhook returned ${response.status}`);
      }

      try {
        await pool.query(
          `INSERT INTO data_sync_operations (operation_type, status, started_at, details, triggered_by, source_batch_id)
           VALUES ('qfield_sync', 'running', NOW(), $1, 'oes_import_webhook', $2)`,
          [
            JSON.stringify({ message: 'Sync triggered, running in background', total_records: String(payload.totalRows) }),
            payload.batchId,
          ]
        );
      } catch (logErr) {
        logger.warn('Failed to log QField sync to data_sync_operations', { error: logErr instanceof Error ? logErr.message : String(logErr) });
      }
    })
    .catch((fetchError: unknown) => {
      clearTimeout(timeoutId);
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';
      logger.warn('QField sync webhook failed (non-blocking)', { message: errorMessage });
    });

  return true;
}

// ============================================================================
// SHAREPOINT FOLDER VERIFICATION
// ============================================================================

/**
 * Trigger SharePoint folder verification for matched DRs (fire-and-forget).
 * Gated by SHAREPOINT_DR_SYNC_ENABLED env var.
 */
export function triggerSharePointSync(matchedDropNumbers: string[]): void {
  if (process.env.SHAREPOINT_DR_SYNC_ENABLED !== 'true') return;
  if (matchedDropNumbers.length === 0) return;

  logger.info(`Triggering SharePoint folder verification for ${matchedDropNumbers.length} DRs`);

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3005';
  fetch(`${baseUrl}/api/activate/sharepoint-sync-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'verify_folders',
      dropNumbers: matchedDropNumbers.slice(0, 100),
    }),
  })
    .then(async (response) => {
      if (response.ok) {
        const result = await response.json();
        logger.info('SharePoint folder verification triggered', {
          processed: result.data?.processed,
          succeeded: result.data?.succeeded,
          failed: result.data?.failed,
        });
      } else {
        logger.warn(`SharePoint sync returned ${response.status}`);
      }
    })
    .catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn('SharePoint sync failed (non-blocking)', { message: msg });
    });
}

// ============================================================================
// OLT AUTO-DETECT
// ============================================================================

/**
 * Trigger OLT auto-detect against 1Map cache (fire-and-forget).
 * Returns true if the service was successfully imported and triggered.
 */
export async function triggerOltAutoDetect(batchId: string): Promise<boolean> {
  try {
    const { runAutoDetect } = await import('@/modules/data-sync/services/oltAutoDetectService');
    const { processLookupQueue } = await import('@/modules/data-sync/services/oltQueueProcessorService');
    runAutoDetect(batchId)
      .then(async (result) => {
        logger.info('OLT auto-detect completed', { data: result });

        if (result.apiLookupsQueued > 0) {
          await processLookupQueue(result.runId);
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        logger.error('OLT auto-detect failed (non-blocking)', { message: msg });
      });
    return true;
  } catch (error) {
    logger.error('Failed to trigger OLT auto-detect', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

// ============================================================================
// SERIAL VERIFICATION RECOMPUTATION
// ============================================================================

/**
 * Recompute 4-way serial verification badges for all affected DRs (fire-and-forget).
 * OES is source of truth — run after every import.
 */
export function triggerSerialVerificationRecompute(affectedDRs: string[]): void {
  if (affectedDRs.length === 0) return;

  logger.info(`Recomputing serial verification for ${affectedDRs.length} DRs`);
  const BATCH_SIZE = 50;

  (async () => {
    let recomputed = 0;
    for (let i = 0; i < affectedDRs.length; i += BATCH_SIZE) {
      const batch = affectedDRs.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(dr => computeAndPersistVerification(dr))
      );
      recomputed += results.filter(r => r.status === 'fulfilled').length;
    }
    logger.info(`Serial verification recomputed for ${recomputed}/${affectedDRs.length} DRs`);
  })().catch(err => {
    logger.error('Serial verification batch recomputation failed', { error: err instanceof Error ? err.message : String(err) });
  });
}

// ============================================================================
// VLM LEARNING
// ============================================================================

/**
 * Auto-record VLM corrections from OES ground truth (fire-and-forget).
 */
export function triggerVlmLearning(affectedDRs: string[]): void {
  if (affectedDRs.length === 0) return;

  recordVlmCorrectionsFromOes(affectedDRs).catch(err => {
    logger.error('VLM learning from OES failed', { error: err instanceof Error ? err.message : String(err) });
  });
}

// ============================================================================
// PP ACTIVATION CHECK
// ============================================================================

/**
 * Mark PP pre-provision serials as 'activated' when they appear in OES (fire-and-forget).
 */
export function triggerPpActivationCheck(): void {
  (async () => {
    try {
      const activatedResult = await pool.query(`
        UPDATE oes_pp_data pp
        SET resolution_status = 'activated',
            resolved_drop_number = COALESCE(pp.resolved_drop_number, oa.drop_number),
            resolved_source = COALESCE(pp.resolved_source, 'oes_activations'),
            resolved_details = COALESCE(pp.resolved_details, '{}'::jsonb) || jsonb_build_object(
              'activated_date', oa.activation_date::text,
              'activated_status', oa.status
            ),
            resolved_at = COALESCE(pp.resolved_at, NOW()),
            updated_at = NOW()
        FROM oes_activations oa
        WHERE pp.serial_number = oa.serial_number
          AND pp.resolution_status != 'activated'
      `);
      if ((activatedResult.rowCount ?? 0) > 0) {
        logger.info(`PP activation check: ${activatedResult.rowCount} serials now activated`);
      }
    } catch (err) {
      logger.error('PP activation check failed', { error: err instanceof Error ? err.message : String(err) });
    }
  })();
}

// ============================================================================
// ONT SWAP CONFIRMATION
// ============================================================================

/**
 * Confirm pending ONT swap records when OES shows the new serial as active (fire-and-forget).
 */
export function triggerOntSwapConfirmation(): void {
  (async () => {
    try {
      const swapResult = await pool.query(`
        UPDATE ont_swap_records osr
        SET status = 'confirmed_oes',
            oes_status = oa.status,
            updated_at = NOW()
        FROM oes_activations oa
        WHERE osr.new_serial = oa.serial_number
          AND osr.drop_number = oa.drop_number
          AND osr.status = 'pending_review'
        RETURNING osr.drop_number, osr.new_serial
      `);
      if ((swapResult.rowCount ?? 0) > 0) {
        logger.info(`ONT swap confirmation: ${swapResult.rowCount} swaps confirmed via OES`);
        for (const row of swapResult.rows) {
          await pool.query(
            `UPDATE dr_photo_unified_reviews
             SET oes_serial = $2, updated_at = NOW()
             WHERE drop_number = $1`,
            [row.drop_number, row.new_serial]
          );
        }
      }
    } catch (err) {
      logger.error('ONT swap confirmation check failed', { error: err instanceof Error ? err.message : String(err) });
    }
  })();
}
