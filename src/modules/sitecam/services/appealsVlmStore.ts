/**
 * Persistence for the appeals-VLM scoring cron (shadow mode). Owns the eligible-row
 * SELECT and the advisory UPDATE. Splits terminal results (set `vlm_evaluated_at`,
 * done) from transient VLM outages (bump `vlm_attempts`, retry until a cap parks
 * the row). NEVER writes `sitecam_appeals.status` — shadow-mode invariant.
 */
import pool from '@/lib/db';
import type { SiteCamJobType } from '@/modules/sitecam/lib/sitecamSteps';
import type { AppealEvaluation } from './appealsVlmService';

export interface PendingAppeal {
  id: string;
  dr_number: string;
  step_number: number;
  job_type: SiteCamJobType | null;
  photo_url: string | null;
  appeal_text: string;
  serial_scanned: string | null;
  serial_expected: string | null;
}

/** Pending, not-yet-scored appeals under the attempt cap, oldest first. */
export async function findPendingAppeals(limit: number, maxAttempts: number): Promise<PendingAppeal[]> {
  const { rows } = await pool.query<PendingAppeal>(
    `SELECT id, dr_number, step_number, job_type, photo_url,
            appeal_text, serial_scanned, serial_expected
     FROM sitecam_appeals
     WHERE status = 'pending'
       AND vlm_evaluated_at IS NULL
       AND COALESCE(vlm_attempts, 0) < $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [maxAttempts, limit],
  );
  return rows;
}

/** Terminal advisory write. Sets vlm_evaluated_at so the row is never re-scored. */
export async function recordEvaluation(id: string, evaluation: AppealEvaluation): Promise<void> {
  await pool.query(
    `UPDATE sitecam_appeals
     SET vlm_recommendation = $2,
         vlm_confidence     = $3,
         vlm_reasoning      = $4,
         vlm_checks         = $5::jsonb,
         vlm_serial_read    = $6,
         vlm_model          = $7,
         vlm_skip_reason    = $8,
         vlm_attempts       = COALESCE(vlm_attempts, 0) + 1,
         vlm_evaluated_at   = NOW()
     WHERE id = $1`,
    [
      id,
      evaluation.recommendation,
      evaluation.confidence,
      evaluation.reasoning,
      JSON.stringify(evaluation.checks),
      evaluation.serialRead ?? null,
      evaluation.model,
      evaluation.skipReason,
    ],
  );
}

/**
 * Transient outage: bump the attempt counter and record the skip reason, but leave
 * vlm_evaluated_at NULL so the row is retried next tick. Once vlm_attempts reaches
 * maxAttempts the findPendingAppeals filter stops selecting it (parked).
 */
export async function recordTransientFailure(
  id: string,
  evaluation: AppealEvaluation,
  maxAttempts: number,
): Promise<{ attempts: number; parked: boolean }> {
  const { rows } = await pool.query<{ vlm_attempts: number }>(
    `UPDATE sitecam_appeals
     SET vlm_attempts    = COALESCE(vlm_attempts, 0) + 1,
         vlm_skip_reason = $2
     WHERE id = $1
     RETURNING vlm_attempts`,
    [id, evaluation.skipReason],
  );
  const attempts = rows[0]?.vlm_attempts ?? 0;
  return { attempts, parked: attempts >= maxAttempts };
}
