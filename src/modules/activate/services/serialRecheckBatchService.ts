/**
 * Serial Recheck Batch Service
 *
 * Silent, unattended adjudication of recent ONT/UPS serial mismatches for the
 * nightly recheck cron. Forward-looking: only processes drops from the last N
 * days. Does NOT send WhatsApp (unlike runSerialRecheck) — it corrects internal
 * records, harvests few-shot examples, and queues the ambiguous tail.
 *
 * - ONT: OES is the source of truth. 1Map ≠ OES → set ONT = OES (audited);
 *   record the WA VLM read as a few-shot error if it also differed.
 * - UPS: no oracle. Re-extract via VLM 2nd-pass. Auto-correct ONLY when both
 *   passes agree AND the stored 1Map value is not a valid Gizzu serial (the
 *   slam-dunk rule). Well-formed-vs-well-formed conflicts are queued for vision.
 *
 * Status: WORKING  NLNH Confidence: HIGH (logic), MEDIUM (live volume untested)
 */

import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { recordVlmCorrection } from '@/services/vlmLearningService';
import { extractUpsSerialRecheck } from './waPhotoExtraction';
import { looksLikeOntSerial, looksLikeGizzuSerial } from './qaAutoFailService';

const VPS_PHOTO_BASE = process.env.VPS_PHOTO_BASE || 'http://72.61.197.178:8866';
const DOCKER_PHOTO_PREFIX = '/var/lib/docker/volumes/boss-vps_dr_photos/_data/';

export interface BatchSummary {
  lookbackDays: number;
  ontChecked: number;
  ontCorrected: number;
  upsChecked: number;
  upsCorrected: number;
  upsQueued: number;
  errors: number;
}

export type UpsAction = 'correct' | 'queue' | 'skip';

/**
 * Decide what to do with a UPS mismatch after the 2nd-pass read.
 * Pure — unit-tested. Auto-correct only on a high-confidence slam-dunk.
 */
export function decideUpsAction(
  firstPass: string | null,
  secondPass: string | null,
  onemap: string | null
): UpsAction {
  const vlmAgree = !!firstPass && firstPass === secondPass && looksLikeGizzuSerial(firstPass);
  if (!vlmAgree) return 'skip'; // inconsistent / unreadable VLM → trust nothing
  if (!looksLikeGizzuSerial(onemap)) return 'correct'; // 1Map invalid → VLM wins
  if (onemap !== firstPass) return 'queue'; // both valid but differ → needs vision
  return 'skip';
}

function norm(s: string | null): string | null {
  return s ? s.trim().toUpperCase() : s;
}

function photoUrl(localPath: string): string {
  return `${VPS_PHOTO_BASE}${localPath.replace(DOCKER_PHOTO_PREFIX, '/photos/')}`;
}

async function logChange(
  drop: string, type: 'ont_serial' | 'ups_serial', oldV: string | null, newV: string,
  reason: string
): Promise<void> {
  await pool.query(
    `INSERT INTO serial_change_history
       (id, drop_number, change_type, old_value, new_value, change_source, change_reason, actor, metadata, detected_at, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'serial-recheck-cron', $7, NOW(), NOW())`,
    [drop, type, oldV, newV, type === 'ont_serial' ? 'onemap_sync' : 'wa_photo_vlm', reason,
     JSON.stringify({ source: 'serial_recheck_cron' })]
  );
}

/** ONT: 1Map ≠ OES → OES wins (OES is source of truth). No VLM call needed. */
async function adjudicateOnt(lookbackDays: number, summary: BatchSummary): Promise<void> {
  const { rows } = await pool.query(
    `SELECT r.drop_number,
            UPPER(TRIM(r.ont_serial_scanned)) AS onemap,
            UPPER(TRIM(r.oes_serial))         AS oes,
            (SELECT UPPER(TRIM(p.vlm_ont_serial)) FROM wa_photos p
              WHERE p.drop_number = r.drop_number AND p.vlm_ont_serial IS NOT NULL AND p.vlm_confidence >= 0.95
              ORDER BY p.vlm_confidence DESC, p.id LIMIT 1) AS vlm
     FROM dr_photo_unified_reviews r
     WHERE COALESCE(r.submitted_date::timestamp, r.created_at) >= NOW() - ($1 || ' days')::interval
       AND r.ont_serial_scanned IS NOT NULL AND r.ont_serial_scanned <> ''
       AND r.oes_serial IS NOT NULL AND r.oes_serial <> ''
       AND UPPER(TRIM(r.ont_serial_scanned)) <> UPPER(TRIM(r.oes_serial))`,
    [lookbackDays]
  );
  for (const row of rows) {
    summary.ontChecked++;
    if (!looksLikeOntSerial(row.oes)) continue; // OES itself malformed → leave
    try {
      await logChange(row.drop_number, 'ont_serial', row.onemap, row.oes,
        'Recheck cron: 1Map ONT differed from OES (source of truth); corrected to OES');
      await pool.query(
        `UPDATE dr_photo_unified_reviews SET ont_serial_scanned = $2, updated_at = NOW() WHERE drop_number = $1`,
        [row.drop_number, row.oes]
      );
      summary.ontCorrected++;
      // The WA VLM read was wrong if it differed from OES → harvest few-shot.
      if (row.vlm && row.vlm !== row.oes) {
        await recordVlmCorrection({
          module: 'activate', analysisType: 'wa_photo_serial', sourceTable: 'wa_photos',
          vlmExtractedValue: row.vlm, correctedValue: row.oes,
          correctionReason: 'ocr_failure', correctionNotes: 'Recheck cron: VLM ONT differed from OES',
          context: { dropNumber: row.drop_number, source: 'serial_recheck_cron' },
        });
      }
    } catch (e) {
      summary.errors++;
      log.error(`Recheck cron ONT fail ${row.drop_number}`, { error: e }, 'SerialRecheckCron');
    }
  }
}

/** UPS: no oracle → VLM 2nd-pass + slam-dunk rule; queue ambiguous. */
async function adjudicateUps(lookbackDays: number, limit: number, summary: BatchSummary): Promise<void> {
  const { rows } = await pool.query(
    `WITH best AS (
       SELECT DISTINCT ON (p.drop_number) p.drop_number,
              UPPER(TRIM(p.vlm_ups_serial)) AS vlm, p.local_path
       FROM wa_photos p
       WHERE p.vlm_ups_serial IS NOT NULL AND p.vlm_confidence >= 0.95
       ORDER BY p.drop_number, p.vlm_confidence DESC, p.id)
     SELECT b.drop_number, b.vlm, b.local_path, UPPER(TRIM(r.ups_serial_scanned)) AS onemap
     FROM best b
     JOIN dr_photo_unified_reviews r ON r.drop_number = b.drop_number
     WHERE COALESCE(r.submitted_date::timestamp, r.created_at) >= NOW() - ($1 || ' days')::interval
       AND r.ups_serial_scanned IS NOT NULL AND r.ups_serial_scanned <> ''
       AND b.vlm <> UPPER(TRIM(r.ups_serial_scanned))
     LIMIT $2`,
    [lookbackDays, limit]
  );
  for (const row of rows) {
    summary.upsChecked++;
    try {
      const recheck = await extractUpsSerialRecheck(photoUrl(row.local_path));
      const pass2 = norm(recheck.serial);
      const action = decideUpsAction(row.vlm, pass2, row.onemap);

      await pool.query(
        `INSERT INTO serial_recheck_log
           (drop_number, triggered_by, serial_type, first_pass_serial, second_pass_serial,
            second_pass_confidence, outcome, onemap_serial)
         VALUES ($1, 'auto', 'ups', $2, $3, $4, $5, $6)`,
        [row.drop_number, row.vlm, pass2, recheck.confidence || null,
         action === 'correct' ? 'correction' : action === 'queue' ? 'verify' : 'unclear', row.onemap]
      );

      if (action === 'correct') {
        await logChange(row.drop_number, 'ups_serial', row.onemap, row.vlm,
          'Recheck cron: 1Map UPS invalid; VLM 2-pass agreed on valid serial');
        await pool.query(
          `UPDATE dr_photo_unified_reviews SET ups_serial_scanned = $2, updated_at = NOW() WHERE drop_number = $1`,
          [row.drop_number, row.vlm]
        );
        summary.upsCorrected++;
        await recordVlmCorrection({
          module: 'activate', analysisType: 'ups_serial', sourceTable: 'wa_photos',
          vlmExtractedValue: row.onemap, correctedValue: row.vlm,
          correctionReason: 'other', correctionNotes: 'Recheck cron: 1Map held invalid UPS value',
          context: { dropNumber: row.drop_number, source: 'serial_recheck_cron' },
        });
      } else if (action === 'queue') {
        summary.upsQueued++; // left for the vision pass via serial_recheck_log outcome='verify'
      }
    } catch (e) {
      summary.errors++;
      log.error(`Recheck cron UPS fail ${row.drop_number}`, { error: e }, 'SerialRecheckCron');
    }
  }
}

export async function runSerialRecheckBatch(
  opts: { lookbackDays?: number; upsLimit?: number } = {}
): Promise<BatchSummary> {
  const lookbackDays = opts.lookbackDays ?? 7;
  const upsLimit = opts.upsLimit ?? 100;
  const summary: BatchSummary = {
    lookbackDays, ontChecked: 0, ontCorrected: 0, upsChecked: 0, upsCorrected: 0, upsQueued: 0, errors: 0,
  };
  log.info(`Serial recheck batch start (lookback=${lookbackDays}d, upsLimit=${upsLimit})`, undefined, 'SerialRecheckCron');
  await adjudicateOnt(lookbackDays, summary);
  await adjudicateUps(lookbackDays, upsLimit, summary);
  log.info('Serial recheck batch done', { summary }, 'SerialRecheckCron');
  return summary;
}
