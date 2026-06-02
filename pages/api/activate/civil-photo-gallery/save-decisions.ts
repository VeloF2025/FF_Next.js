/**
 * API Route: POST /api/activate/civil-photo-gallery/save-decisions
 *
 * Updates the label for existing civils photo rows in vlm_visual_photo_examples.
 * 'good' → label = 'positive', 'bad' → label = 'negative'
 *
 * Auth: requires `manager` role or higher.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withRole } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { pool } from '@/lib/db';
import { log } from '@/lib/logger';

const MAX_DECISIONS = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DecisionInput {
  id: string;
  decision: 'good' | 'bad';
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const decisions = req.body?.decisions as DecisionInput[] | undefined;
  if (!Array.isArray(decisions) || decisions.length === 0) {
    return apiResponse.badRequest(res, 'decisions must be a non-empty array');
  }
  if (decisions.length > MAX_DECISIONS) {
    return apiResponse.badRequest(res, `decisions cannot exceed ${MAX_DECISIONS} per request`);
  }

  let updated = 0;

  for (const d of decisions) {
    if (!d.id || typeof d.id !== 'string' || !UUID_RE.test(d.id)) continue;
    if (d.decision !== 'good' && d.decision !== 'bad') continue;

    const label = d.decision === 'good' ? 'positive' : 'negative';

    try {
      const result = await pool.query(
        `UPDATE vlm_visual_photo_examples
         SET label = $1
         WHERE id = $2 AND job_type = 'civils'`,
        [label, d.id],
      );
      if ((result.rowCount ?? 0) > 0) {
        updated++;
      }
    } catch (err) {
      log.error(
        '[CivilSaveDecisions] Error updating decision',
        { id: d.id, error: err instanceof Error ? err.message : String(err) },
        'CivilPhotoGallery',
      );
      // Non-fatal — continue processing remaining decisions.
    }
  }

  log.info(`[CivilSaveDecisions] Updated ${updated} decisions`, undefined, 'CivilPhotoGallery');
  return apiResponse.success(res, { updated });
}

export default withAuth(withRole('manager')(handler));
