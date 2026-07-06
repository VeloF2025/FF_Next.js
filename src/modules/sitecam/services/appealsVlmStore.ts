/**
 * Persistence for the appeals-VLM scoring cron. Owns the eligible-row SELECT and
 * the result writes. Splits terminal results (set `vlm_evaluated_at`, done) from
 * transient VLM outages (bump `vlm_attempts`, retry until a cap parks the row).
 *
 * Two terminal writes:
 *   - `recordEvaluation`   — ADVISORY only (shadow mode). Writes vlm_* columns and
 *                            NEVER touches `status`. A human still decides.
 *   - `recordAutoDecision` — GO-LIVE. Writes vlm_* AND sets `status`/`decided_via='vlm'`.
 *                            Gated by the `appeals_vlm_autodecide` system flag +
 *                            a confidence threshold in the runner; guarded here so
 *                            it can never overwrite a decision a human already made.
 */
import pool from '@/lib/db';
import type { SiteCamJobType } from '@/modules/sitecam/lib/sitecamSteps';
import type { AppealEvaluation } from './appealsVlmService';

/**
 * Is VLM auto-decide live? OFF/absent → shadow mode (advisory only). Flip the
 * `appeals_vlm_autodecide` row to 'false' to instantly revert to advise-only with
 * no redeploy. Mirrors how the auto-feedback cron reads `auto_feedback_enabled`.
 */
export async function isAutoDecideEnabled(): Promise<boolean> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM system_flags WHERE key = 'appeals_vlm_autodecide'`,
  );
  return rows[0]?.value === 'true';
}

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

const PENDING_COLUMNS = `id, dr_number, step_number, job_type, photo_url,
            appeal_text, serial_scanned, serial_expected`;

/** Pending, not-yet-scored appeals under the attempt cap, oldest first. */
export async function findPendingAppeals(limit: number, maxAttempts: number): Promise<PendingAppeal[]> {
  const { rows } = await pool.query<PendingAppeal>(
    `SELECT ${PENDING_COLUMNS}
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

/**
 * A single still-eligible appeal by id — used by the on-submit fast path so a
 * fresh appeal is scored in seconds instead of waiting for the next cron tick.
 * Returns null if it was already scored or decided (nothing to do).
 */
export async function findEligibleAppealById(id: string): Promise<PendingAppeal | null> {
  const { rows } = await pool.query<PendingAppeal>(
    `SELECT ${PENDING_COLUMNS}
     FROM sitecam_appeals
     WHERE id = $1
       AND status = 'pending'
       AND vlm_evaluated_at IS NULL`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Terminal ADVISORY write (shadow mode). Sets vlm_evaluated_at so the row is never
 * re-scored, and NEVER touches `status`. The `vlm_evaluated_at IS NULL` guard makes
 * it claim-once: if the on-submit fast path and a cron tick race, only the first
 * write lands. Returns true if this call was the one that recorded it.
 */
export async function recordEvaluation(id: string, evaluation: AppealEvaluation): Promise<boolean> {
  const { rowCount } = await pool.query(
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
     WHERE id = $1
       AND vlm_evaluated_at IS NULL`,
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
  return (rowCount ?? 0) > 0;
}

/**
 * Terminal GO-LIVE write. Records the vlm_* columns AND applies the decision:
 * sets `status`, `decided_via='vlm'`, `decided_at`, and (on deny) copies the VLM
 * reasoning into `denial_reason` so the technician sees why via appeal-status.
 *
 * The `status = 'pending' AND vlm_evaluated_at IS NULL` guard is the safety net:
 * it can never overwrite a decision a human (or an earlier tick) already made, and
 * `human_agreed_with_vlm` is left NULL — no human was in this loop. Returns true if
 * this call actually applied the decision.
 */
export async function recordAutoDecision(
  id: string,
  evaluation: AppealEvaluation,
  decision: 'approved' | 'denied',
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE sitecam_appeals
     SET vlm_recommendation = $2,
         vlm_confidence     = $3,
         vlm_reasoning      = $4,
         vlm_checks         = $5::jsonb,
         vlm_serial_read    = $6,
         vlm_model          = $7,
         vlm_skip_reason    = $8,
         vlm_attempts       = COALESCE(vlm_attempts, 0) + 1,
         vlm_evaluated_at   = NOW(),
         status             = $9,
         decided_via        = 'vlm',
         decided_by         = NULL,
         decided_at         = NOW(),
         denial_reason      = CASE WHEN $9 = 'denied' THEN $4 ELSE denial_reason END
     WHERE id = $1
       AND status = 'pending'
       AND vlm_evaluated_at IS NULL`,
    [
      id,
      evaluation.recommendation,
      evaluation.confidence,
      evaluation.reasoning,
      JSON.stringify(evaluation.checks),
      evaluation.serialRead ?? null,
      evaluation.model,
      evaluation.skipReason,
      decision,
    ],
  );
  return (rowCount ?? 0) > 0;
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
