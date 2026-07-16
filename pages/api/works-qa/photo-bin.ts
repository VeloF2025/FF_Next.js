/**
 * POST /api/works-qa/photo-bin
 *
 * Soft-delete recycle bin for unassigned pole photos.
 *
 *   action='delete'  → move photo_key from unassigned_photo_keys → deleted_photo_keys
 *   action='restore' → move photo_key from deleted_photo_keys    → unassigned_photo_keys
 *
 * Body:
 *   pole_id    UUID
 *   photo_key  storage key currently held in the source array
 *   action     'delete' | 'restore'
 *
 * Deliberately SEPARATE from move-photo and does NOT write a
 * qa_correction_examples row: binning a junk/duplicate photo is not a VLM
 * misclassification, so logging it would poison the training set (same
 * reasoning link-photo uses to skip correction logging). The underlying MinIO
 * blob is never touched — only the DB reference moves between arrays.
 *
 * Staged lifecycle (enforced by the UI): slot → unassigned → deleted, restore
 * back to unassigned. There is no direct slot → deleted path.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { log } from '@/lib/logger';

interface BinBody {
  pole_id?: string;
  photo_key?: string;
  action?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  const { pole_id, photo_key, action } = req.body as BinBody;
  if (!pole_id) return apiResponse.badRequest(res, 'pole_id required');
  if (!photo_key) return apiResponse.badRequest(res, 'photo_key required');
  if (action !== 'delete' && action !== 'restore') {
    return apiResponse.badRequest(res, "action must be 'delete' or 'restore'");
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const fetchRes = await client.query<{ unassigned_photo_keys: string[]; deleted_photo_keys: string[] }>(
      `SELECT unassigned_photo_keys, deleted_photo_keys
       FROM pole_qa_photos WHERE id = $1::uuid FOR UPDATE`,
      [pole_id],
    );
    if (fetchRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return apiResponse.notFound(res, 'Pole', pole_id);
    }
    const row = fetchRes.rows[0]!;
    const sourceArray = action === 'delete' ? row.unassigned_photo_keys : row.deleted_photo_keys;
    if (!sourceArray.includes(photo_key)) {
      await client.query('ROLLBACK');
      return apiResponse.badRequest(res, `photo_key not found in ${action === 'delete' ? 'unassigned' : 'deleted'} bucket`);
    }

    // Move the key between arrays. `array_append(array_remove(dest, k), k)`
    // guarantees the destination holds exactly one occurrence even if a prior
    // partial run left a stray copy. On delete, also drop any stale auto-sort
    // suggestion for the photo — a deleted photo must not resurface a "→ slot"
    // badge if it is later restored.
    if (action === 'delete') {
      await client.query(
        `UPDATE pole_qa_photos
         SET unassigned_photo_keys = array_remove(unassigned_photo_keys, $1),
             deleted_photo_keys    = array_append(array_remove(deleted_photo_keys, $1), $1),
             unassigned_suggestions = unassigned_suggestions - $1::text,
             updated_at = NOW()
         WHERE id = $2::uuid`,
        [photo_key, pole_id],
      );
    } else {
      await client.query(
        `UPDATE pole_qa_photos
         SET deleted_photo_keys    = array_remove(deleted_photo_keys, $1),
             unassigned_photo_keys = array_append(array_remove(unassigned_photo_keys, $1), $1),
             updated_at = NOW()
         WHERE id = $2::uuid`,
        [photo_key, pole_id],
      );
    }

    await client.query('COMMIT');
    return apiResponse.success(res, { action, photo_key });
  } catch (err) {
    await client.query('ROLLBACK').catch(rbErr => {
      log.warn('works-qa/photo-bin: rollback failed', { error: rbErr instanceof Error ? rbErr.message : String(rbErr) });
    });
    log.error('works-qa/photo-bin', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  } finally {
    client.release();
  }
}

export default withAuth(withPermission('construction-qa.works-qa.override', 'edit')(handler));
