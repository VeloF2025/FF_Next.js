/**
 * POST /api/works-qa/link-photo
 *
 * Reuse ONE photo for a second step on the same pole — e.g. a depth-with-tape
 * shot that also clearly shows the end-plates. Copies the source slot's photo
 * key into the target slot (the source keeps its photo) and records a
 * dual-step override on the target.
 *
 * Deliberately does NOT write qa_correction_examples: this is "one photo shows
 * two steps", NOT "the VLM mis-classified this photo". Logging it as a
 * correction would teach the model that e.g. a depth photo IS an end-plates
 * photo and poison training. The target's vlm_results entry carries
 * dual_step=true + source_slot so it is auditable and filterable.
 *
 * Body:
 *   pole_id      UUID
 *   source_slot  slot key that holds the photo to reuse
 *   target_slot  slot key to populate (must differ; same discipline)
 *   reason       optional free-text note
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { SLOT_META, getSlotMeta } from '@/modules/works-qa/utils/slot-keys';
import type { VlmSlotResult } from '@/modules/works-qa/types/works-qa.types';

const ALLOWED_PHOTO_COLUMNS = new Set(SLOT_META.map(s => s.dbColumn));

interface LinkBody {
  pole_id?: string;
  source_slot?: string;
  target_slot?: string;
  reason?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  const { pole_id, source_slot, target_slot, reason } = req.body as LinkBody;
  if (!pole_id) return apiResponse.badRequest(res, 'pole_id required');
  if (!source_slot) return apiResponse.badRequest(res, 'source_slot required');
  if (!target_slot) return apiResponse.badRequest(res, 'target_slot required');
  if (source_slot === target_slot) return apiResponse.badRequest(res, 'source_slot and target_slot must differ');

  const sourceMeta = getSlotMeta(source_slot);
  const targetMeta = getSlotMeta(target_slot);
  if (!sourceMeta) return apiResponse.badRequest(res, `Unknown source slot: ${source_slot}`);
  if (!targetMeta) return apiResponse.badRequest(res, `Unknown target slot: ${target_slot}`);
  if (sourceMeta.discipline !== targetMeta.discipline) {
    return apiResponse.badRequest(res, 'source and target must be the same discipline');
  }
  if (!ALLOWED_PHOTO_COLUMNS.has(sourceMeta.dbColumn) || !ALLOWED_PHOTO_COLUMNS.has(targetMeta.dbColumn)) {
    return apiResponse.badRequest(res, 'illegal column');
  }

  const userEmail = (req as AuthenticatedNextApiRequest).user.email;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const fetchRes = await client.query<{
      id: string;
      vlm_results: Record<string, VlmSlotResult>;
      [col: string]: unknown;
    }>(
      `SELECT id, vlm_results, ${sourceMeta.dbColumn} AS src_key, ${targetMeta.dbColumn} AS tgt_key
       FROM pole_qa_photos WHERE id = $1::uuid FOR UPDATE`,
      [pole_id],
    );
    if (fetchRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return apiResponse.notFound(res, 'Pole', pole_id);
    }
    const row = fetchRes.rows[0]!;
    const sourceKey = row.src_key as string | null;
    const targetKey = row.tgt_key as string | null;
    const vlmResults = row.vlm_results ?? {};

    if (!sourceKey || targetKey === sourceKey) {
      // No writes have happened yet, but guard the rollback so a failed ROLLBACK
      // can't leave the pooled connection in a broken state (matches the
      // catch-block rollback below).
      await client.query('ROLLBACK').catch(rbErr => {
        log.warn('works-qa/link-photo: pre-write rollback failed', { error: rbErr instanceof Error ? rbErr.message : String(rbErr) });
      });
      return apiResponse.badRequest(
        res,
        sourceKey ? 'target slot already holds this photo' : 'source slot has no photo to reuse',
      );
    }

    // If the target already holds a DIFFERENT photo, push it back to the
    // unassigned bucket rather than silently discard it (mirrors move-photo).
    if (targetKey && targetKey !== sourceKey) {
      await client.query(
        `UPDATE pole_qa_photos
         SET unassigned_photo_keys = array_append(unassigned_photo_keys, $1),
             unassigned_suggestions = unassigned_suggestions - $1::text,
             updated_at = NOW()
         WHERE id = $2::uuid`,
        [targetKey, pole_id],
      );
    }

    const targetEntry: VlmSlotResult = {
      ...(vlmResults[target_slot] ?? { valid: true, confidence: 0, feedback: '' }),
      valid: true,
      overridden_by: userEmail,
      override_reason: reason?.trim() || `Same photo as ${sourceMeta.label}`,
      dual_step: true,
      source_slot,
    };

    await client.query(
      `UPDATE pole_qa_photos
       SET ${targetMeta.dbColumn} = $1,
           vlm_results = vlm_results || $2::jsonb,
           updated_at = NOW()
       WHERE id = $3::uuid`,
      [sourceKey, JSON.stringify({ [target_slot]: targetEntry }), pole_id],
    );

    await client.query('COMMIT');
    return apiResponse.success(res, {
      linked: true,
      source_slot,
      target_slot,
      photo_key: sourceKey,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(rbErr => {
      log.warn('works-qa/link-photo: rollback failed', { error: rbErr instanceof Error ? rbErr.message : String(rbErr) });
    });
    log.error('works-qa/link-photo', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  } finally {
    client.release();
  }
}

export default withAuth(withPermission('construction-qa.works-qa.override', 'edit')(handler));
