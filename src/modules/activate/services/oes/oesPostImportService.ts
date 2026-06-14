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
import { promoteOesActivatedSerials, reconcileInStockOesActivated } from './oesSerialLifecycle';

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

interface ActivatedPpRow {
  drop_number: string;
  activation_date: string | null;
  serial_number: string;
  maintenance_ticket_id: string | null;
}

/**
 * Mark PP pre-provision serials as 'activated' when they appear in OES (fire-and-forget).
 *
 * Two promotion paths feed one downstream cascade:
 *   A. SERIAL-keyed — a PP row whose serial_number now appears in oes_activations.
 *   B. DROP-keyed (#1861/D4-1) — a still-`located_*` PP row whose resolved_drop_number
 *      is in oes_activations. Without this the PP/OES overlap was understated, since
 *      a located row whose serial differs from (or is absent in) OES never matched
 *      path A. Serial CONFLICTS are skipped (promoted only when PP and OES agree on
 *      the serial, or one side has none) so we never stamp 'activated' over a
 *      genuine PP-vs-OES serial disagreement (#1861/D1-5, D4-2).
 *
 * On flip-to-activated each row also: sets activated_at from OES (#1861/D4-4),
 * back-propagates drops.oes_confirmed (#1861/D4-5), emits a DR-timeline
 * pre_prov_resolved event, promotes the stock_serials lifecycle, and auto-resolves
 * any linked open NOC ticket.
 */
export function triggerPpActivationCheck(): void {
  (async () => {
    try {
      // Path A — serial-keyed promotion. Now also stamps activated_at (D4-4).
      const serialResult = await pool.query<ActivatedPpRow>(`
        UPDATE oes_pp_data pp
        SET resolution_status = 'activated',
            resolved_drop_number = COALESCE(pp.resolved_drop_number, oa.drop_number),
            resolved_source = COALESCE(pp.resolved_source, 'oes_activations'),
            resolved_details = COALESCE(pp.resolved_details, '{}'::jsonb) || jsonb_build_object(
              'activated_date', oa.activation_date::text,
              'activated_status', oa.status
            ),
            activated_at = COALESCE(pp.activated_at, oa.activation_datetime, oa.activation_date::timestamptz),
            resolved_at = COALESCE(pp.resolved_at, NOW()),
            updated_at = NOW()
        FROM oes_activations oa
        WHERE pp.serial_number = oa.serial_number
          AND pp.resolution_status != 'activated'
        RETURNING oa.drop_number, oa.activation_date::text, pp.serial_number, pp.maintenance_ticket_id
      `);

      // Path B — drop-keyed promotion of located_* rows whose drop is in OES (D4-1),
      // skipping serial conflicts (D1-5/D4-2). DISTINCT ON picks one activation per
      // drop so a drop with >1 oes_activations row promotes the PP row exactly once.
      const locatedResult = await pool.query<ActivatedPpRow>(`
        WITH oa1 AS (
          SELECT DISTINCT ON (drop_number)
                 drop_number, serial_number, activation_date, activation_datetime, status
          FROM oes_activations
          ORDER BY drop_number, activation_datetime DESC NULLS LAST
        )
        UPDATE oes_pp_data pp
        SET resolution_status = 'activated',
            resolved_source = COALESCE(pp.resolved_source, 'oes_activations'),
            resolved_details = COALESCE(pp.resolved_details, '{}'::jsonb) || jsonb_build_object(
              'activated_date', oa1.activation_date::text,
              'activated_status', oa1.status,
              'promoted_from', pp.resolution_status
            ),
            activated_at = COALESCE(pp.activated_at, oa1.activation_datetime, oa1.activation_date::timestamptz),
            resolved_at = COALESCE(pp.resolved_at, NOW()),
            updated_at = NOW()
        FROM oa1
        WHERE oa1.drop_number = pp.resolved_drop_number
          AND pp.resolution_status IN ('located_1map', 'located_local', 'located_unified')
          AND NOT (
            pp.serial_number IS NOT NULL AND TRIM(pp.serial_number) NOT IN ('', '-')
            AND oa1.serial_number IS NOT NULL AND TRIM(oa1.serial_number) NOT IN ('', '-')
            AND UPPER(TRIM(pp.serial_number)) <> UPPER(TRIM(oa1.serial_number))
          )
        RETURNING oa1.drop_number, oa1.activation_date::text, COALESCE(pp.serial_number, '') AS serial_number, pp.maintenance_ticket_id
      `);

      const promotedRows = [...serialResult.rows, ...locatedResult.rows];
      if (promotedRows.length > 0) {
        logger.info(
          `PP activation check: ${serialResult.rowCount} serial-keyed + ${locatedResult.rowCount} located→activated`,
        );

        // Back-propagate drops.oes_confirmed for the drops just activated (D4-5).
        const promotedDrops = [...new Set(promotedRows.map((r) => r.drop_number).filter(Boolean))];
        if (promotedDrops.length > 0) {
          await pool.query(
            `UPDATE drops
                SET oes_confirmed = true,
                    oes_confirmed_at = COALESCE(oes_confirmed_at, NOW())
              WHERE drop_number = ANY($1::text[])
                AND (oes_confirmed = false OR oes_confirmed IS NULL)`,
            [promotedDrops],
          ).catch((err: unknown) => {
            logger.warn('drops.oes_confirmed back-propagation skipped', {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }

        const activatedResult = { rowCount: promotedRows.length, rows: promotedRows };

        // ── Sprint E Track 2.6: OES installed → activated lifecycle promotion ──
        //
        // DORMANT PRE-CUTOVER: mig 364 TRIGGER 3 (`trg_oes_pp_data_after_insert_activate`)
        // fires on oes_pp_data INSERT/UPDATE and directly sets stock_serials.status →
        // 'activated' before this application-layer code runs. By the time we reach
        // this point, TRIGGER 3 has already raced ahead — so promoteSerial calls for
        // serials already in 'activated' state will be no-ops (mig 387 matrix row 73
        // source='installed' won't match 'activated' current state).
        //
        // POST-CUTOVER (Track 7): TRIGGER 3 will be retired. This loop becomes the
        // sole `installed → activated` writer for the OES activation path.
        // Matrix row 73: `installed → activated` → event_type='activated_on_oes'.
        //
        // Implementation: for each activated serial, look up its stock_serials row.
        // If status='installed', promote to 'activated' via the lifecycle state machine.
        // Serials already in 'activated' (TRIGGER 3 pre-cutover) are silently skipped.
        await promoteOesActivatedSerials(activatedResult.rows);

        // ── Durable reconciliation (issue #1860 regrowth fix) ─────────────────
        // The PP-delta promotion above only covers serials whose oes_pp_data row
        // was just flipped to 'activated'. Serials that go Active on OES WITHOUT
        // transiting the PP list accumulate stuck in_stock (D1-1 regrew 0 → 1155
        // between 2026-05-31 and 2026-06-14, all NULL-holder June activations).
        // A full reconciliation pass here promotes them too. Best-effort: a
        // failure here never aborts the rest of the post-import work.
        try {
          const recon = await reconcileInStockOesActivated();
          if (recon.scanned > 0) {
            logger.info('OES in_stock reconciliation pass complete', { scanned: recon.scanned });
          }
        } catch (reconErr) {
          logger.warn('OES in_stock reconciliation pass skipped (non-blocking)', {
            error: reconErr instanceof Error ? reconErr.message : String(reconErr),
          });
        }

        // Action Centre timeline: emit pre_prov_resolved for each newly-activated
        // PP row so the DR timeline shows "pre-provisioned → active" transition.
        // Best-effort — never fail the check on a log error.
        try {
          const { logPreProvResolved } = await import(
            '@/modules/activate/services/activity-log/eventLoggers'
          );
          await Promise.all(
            activatedResult.rows.map((r: ActivatedPpRow) =>
              logPreProvResolved(
                r.drop_number,
                { resolutionReason: 'activated_on_oes', activationDate: r.activation_date ?? null },
                'oes-post-import',
              ).catch(() => undefined),
            ),
          );
        } catch (e) {
          logger.warn('Timeline log for pre_prov_resolved skipped', {
            error: e instanceof Error ? e.message : String(e),
          });
        }

        // Auto-resolve any linked NOC ticket whose underlying PP serial just
        // activated on OES. We only flip tickets that are still in an open-ish
        // state — never overwrite a manual close, QA flow, or cancellation.
        const ticketRows = activatedResult.rows.filter(
          (r: ActivatedPpRow) => !!r.maintenance_ticket_id,
        );
        if (ticketRows.length > 0) {
          await autoResolveActivatedPpTickets(ticketRows);
        }
      }
    } catch (err) {
      logger.error('PP activation check failed', { error: err instanceof Error ? err.message : String(err) });
    }
  })();
}

/**
 * Flip linked NOC tickets to 'resolved' when their PP serial just activated.
 * Logs a status_change activity per ticket so the audit trail is complete.
 *
 * Open-ish states eligible for auto-resolve:
 *   open, assigned, in_progress
 * QA / handover / verified / closed / cancelled tickets are left alone.
 *
 * Recency guard: skip tickets whose `updated_at` is within the last 48 hours.
 * Mirrors the same safety rail as the action-centre rule engine
 * (`pre_prov_activated_close_tickets`, RECENT_HUMAN_EDIT_WINDOW_HOURS = 48).
 * A human just touched the ticket — let them finish before we close it.
 */
const RESOLVE_RECENT_HUMAN_EDIT_WINDOW_HOURS = 48;

async function autoResolveActivatedPpTickets(
  rows: ReadonlyArray<ActivatedPpRow>,
): Promise<void> {
  const RESOLVABLE_STATUSES = ['open', 'assigned', 'in_progress'];
  const { logTicketActivity } = await import('@/modules/noc/services/ticketService');

  for (const r of rows) {
    if (!r.maintenance_ticket_id) continue;
    try {
      const updateResult = await pool.query<{ id: string; ticket_uid: string; previous_status: string }>(
        `WITH prev AS (
           SELECT id, ticket_uid, status AS previous_status
           FROM maintenance_tickets
           WHERE id = $1
         )
         UPDATE maintenance_tickets t
         SET status = 'resolved',
             updated_at = NOW()
         FROM prev
         WHERE t.id = prev.id
           AND t.status = ANY($2::text[])
           AND t.updated_at < NOW() - ($3 || ' hours')::interval
         RETURNING t.id, t.ticket_uid, prev.previous_status`,
        [r.maintenance_ticket_id, RESOLVABLE_STATUSES, RESOLVE_RECENT_HUMAN_EDIT_WINDOW_HOURS],
      );

      const ticket = updateResult.rows[0];
      if (!ticket) continue; // Ticket was in a non-resolvable state — leave it.

      const dateLabel = r.activation_date
        ? new Date(r.activation_date).toISOString().slice(0, 10)
        : 'unknown date';
      const description = `Auto-resolved: serial ${r.serial_number} activated on OES ${dateLabel}, DR ${r.drop_number}`;

      // logTicketActivity swallows its own DB errors internally (logs them
      // via its own logger). No outer .catch() needed — it never rejects.
      await logTicketActivity({
        ticketId: ticket.id,
        activityType: 'status_change',
        description,
        fieldChanges: { status: { from: ticket.previous_status, to: 'resolved' } },
        userName: 'System',
        userEmail: 'system@fibreflow.app',
      });

      // Write a resolution note on the Notes tab so the ticket shows the
      // outcome alongside any human-authored notes (the History tab also has
      // the entry above, but operators expect to see resolutions on Notes).
      await pool.query(
        `INSERT INTO maintenance_notes
           (ticket_id, content, note_type, visibility, is_resolution)
         VALUES ($1, $2, 'system', 'public', true)`,
        [ticket.id, description],
      ).catch((err: unknown) => {
        logger.warn('Failed to insert auto-resolve note', {
          ticketId: ticket.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      try {
        const { logTicketStatusChanged } = await import(
          '@/modules/activate/services/activity-log/eventLoggers'
        );
        await logTicketStatusChanged(
          r.drop_number,
          {
            ticketId: ticket.id,
            ticketUid: ticket.ticket_uid,
            fromStatus: ticket.previous_status,
            toStatus: 'resolved',
          },
          'oes-post-import',
        );
      } catch (e) {
        logger.warn('DR timeline log for auto-resolve skipped', {
          ticketUid: ticket.ticket_uid,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    } catch (err) {
      logger.warn('Auto-resolve failed for PP ticket', {
        ticketId: r.maintenance_ticket_id,
        serial: r.serial_number,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
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
