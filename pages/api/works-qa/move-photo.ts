/**
 * POST /api/works-qa/move-photo
 *
 * Reassigns a photo between slots (or to/from the unassigned bucket) on a
 * single pole_qa_photos row. Every move records a row in qa_correction_examples
 * with workflow_type='works_qa' so the VLM model can learn from human
 * reassignments.
 *
 * Body:
 *   pole_id    UUID
 *   photo_key  storage key currently held in `from`
 *   from       slot key (civil_01…main_joint_16) OR 'unassigned'
 *   to         slot key OR 'unassigned'  (must differ from `from`)
 *
 * Effects:
 *   - Source slot's column is cleared (or photo_key spliced from
 *     unassigned_photo_keys).
 *   - Destination slot's column is set to photo_key (or appended to
 *     unassigned_photo_keys for delete-to-bucket).
 *   - vlm_results entry for the destination slot is marked
 *     overridden_by=caller, valid=true.
 *   - VLM-results entry for the source slot (if any) is removed.
 *   - One qa_correction_examples row inserted summarising the move.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { SLOT_META, getSlotMeta } from '@/modules/works-qa/utils/slot-keys';

const ALLOWED_PHOTO_COLUMNS = new Set(SLOT_META.map(s => s.dbColumn));

interface MoveBody {
  pole_id?: string;
  photo_key?: string;
  from?: string;
  to?: string;
}

interface VlmEntry {
  valid?: boolean;
  confidence?: number;
  feedback?: string;
  overridden_by?: string;
  override_reason?: string;
}

function isUnassigned(slot: string): boolean {
  return slot === 'unassigned';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  const { pole_id, photo_key, from, to } = req.body as MoveBody;
  if (!pole_id) return apiResponse.badRequest(res, 'pole_id required');
  if (!photo_key) return apiResponse.badRequest(res, 'photo_key required');
  if (!from || !to) return apiResponse.badRequest(res, 'from and to required');
  if (from === to) return apiResponse.badRequest(res, 'from and to must differ');

  const fromMeta = isUnassigned(from) ? null : getSlotMeta(from);
  const toMeta = isUnassigned(to) ? null : getSlotMeta(to);
  if (!isUnassigned(from) && !fromMeta) return apiResponse.badRequest(res, `Unknown from slot: ${from}`);
  if (!isUnassigned(to) && !toMeta) return apiResponse.badRequest(res, `Unknown to slot: ${to}`);
  if (fromMeta && !ALLOWED_PHOTO_COLUMNS.has(fromMeta.dbColumn)) return apiResponse.badRequest(res, 'illegal column');
  if (toMeta && !ALLOWED_PHOTO_COLUMNS.has(toMeta.dbColumn)) return apiResponse.badRequest(res, 'illegal column');

  const userEmail = (req as AuthenticatedNextApiRequest).user.email;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Fetch current state (also our source-of-truth for vlm metadata to record)
    const fetchRes = await client.query<{ id: string; vlm_results: Record<string, VlmEntry>; unassigned_photo_keys: string[] }>(
      `SELECT id, vlm_results, unassigned_photo_keys
       FROM pole_qa_photos WHERE id = $1::uuid FOR UPDATE`,
      [pole_id],
    );
    if (fetchRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return apiResponse.notFound(res, 'Pole', pole_id);
    }
    const row = fetchRes.rows[0]!;
    const vlmResults = row.vlm_results ?? {};

    // Confirm photo_key actually lives in the source slot before mutating
    if (fromMeta) {
      const check = await client.query<{ col_val: string | null }>(
        `SELECT ${fromMeta.dbColumn} AS col_val FROM pole_qa_photos WHERE id = $1::uuid`,
        [pole_id],
      );
      if (check.rows[0]?.col_val !== photo_key) {
        await client.query('ROLLBACK');
        return apiResponse.badRequest(res, 'photo_key does not match the source slot');
      }
    } else if (!row.unassigned_photo_keys.includes(photo_key)) {
      await client.query('ROLLBACK');
      return apiResponse.badRequest(res, 'photo_key not found in unassigned bucket');
    }

    // 1. Clear source
    if (fromMeta) {
      await client.query(
        `UPDATE pole_qa_photos SET ${fromMeta.dbColumn} = NULL, updated_at = NOW() WHERE id = $1::uuid`,
        [pole_id],
      );
    } else {
      // Remove from unassigned array
      await client.query(
        `UPDATE pole_qa_photos
         SET unassigned_photo_keys = array_remove(unassigned_photo_keys, $1),
             updated_at = NOW()
         WHERE id = $2::uuid`,
        [photo_key, pole_id],
      );
    }

    // 2. Set destination
    if (toMeta) {
      // If destination slot already has a photo, push it back to unassigned to avoid clobbering
      const dest = await client.query<{ col_val: string | null }>(
        `SELECT ${toMeta.dbColumn} AS col_val FROM pole_qa_photos WHERE id = $1::uuid`,
        [pole_id],
      );
      const displaced = dest.rows[0]?.col_val ?? null;
      if (displaced && displaced !== photo_key) {
        await client.query(
          `UPDATE pole_qa_photos
           SET unassigned_photo_keys = array_append(unassigned_photo_keys, $1),
               updated_at = NOW()
           WHERE id = $2::uuid`,
          [displaced, pole_id],
        );
      }

      // Record the override: human asserted this photo belongs here, so mark valid=true.
      const newSlotEntry: VlmEntry = {
        ...(vlmResults[toMeta.key] ?? {}),
        valid: true,
        overridden_by: userEmail,
        override_reason: `Reassigned from ${from}`,
      };
      const patch: Record<string, VlmEntry> = { [toMeta.key]: newSlotEntry };

      // Also strip any stale entry for the from-slot so it doesn't keep a phantom failure
      if (fromMeta && vlmResults[fromMeta.key]) {
        // jsonb '-' operator removes the key; do it in a separate query for clarity
        await client.query(
          `UPDATE pole_qa_photos SET vlm_results = vlm_results - $1 WHERE id = $2::uuid`,
          [fromMeta.key, pole_id],
        );
      }

      await client.query(
        `UPDATE pole_qa_photos
         SET ${toMeta.dbColumn} = $1,
             vlm_results = vlm_results || $2::jsonb,
             updated_at = NOW()
         WHERE id = $3::uuid`,
        [photo_key, JSON.stringify(patch), pole_id],
      );
    } else {
      // Moving to unassigned bucket
      if (fromMeta && vlmResults[fromMeta.key]) {
        await client.query(
          `UPDATE pole_qa_photos SET vlm_results = vlm_results - $1 WHERE id = $2::uuid`,
          [fromMeta.key, pole_id],
        );
      }
      await client.query(
        `UPDATE pole_qa_photos
         SET unassigned_photo_keys = array_append(unassigned_photo_keys, $1),
             updated_at = NOW()
         WHERE id = $2::uuid`,
        [photo_key, pole_id],
      );
    }

    // 3. VLM learning — record the human correction
    const predictedStep = fromMeta?.stepNumber ?? 0;
    const predictedCategory = fromMeta?.discipline ?? 'unassigned';
    const correctStep = toMeta?.stepNumber ?? 0;
    const correctCategory = toMeta?.discipline ?? 'unassigned';
    const sourceVlm = fromMeta ? vlmResults[fromMeta.key] : undefined;
    const vlmConfidence = typeof sourceVlm?.confidence === 'number' ? sourceVlm.confidence : 0;
    const vlmReasoning = sourceVlm?.feedback ?? '';

    await client.query(
      `INSERT INTO qa_correction_examples
        (workflow_type, photo_filename, vlm_predicted_step, vlm_predicted_category,
         vlm_confidence, vlm_reasoning, correct_step, correct_category,
         correction_reason, corrected_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        'works_qa',
        photo_key,
        predictedStep,
        predictedCategory,
        vlmConfidence,
        vlmReasoning,
        correctStep,
        correctCategory,
        'manual_reassignment',
        userEmail,
      ],
    );

    await client.query('COMMIT');
    return apiResponse.success(res, { moved: true, from, to });
  } catch (err) {
    await client.query('ROLLBACK').catch(rbErr => {
      log.warn('works-qa/move-photo: rollback failed', { error: rbErr instanceof Error ? rbErr.message : String(rbErr) });
    });
    log.error('works-qa/move-photo', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  } finally {
    client.release();
  }
}

export default withAuth(withPermission('construction-qa.works-qa.override', 'edit')(handler));
