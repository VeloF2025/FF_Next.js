import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { log } from '@/lib/logger';
import { SLOT_META } from '@/modules/works-qa/utils/slot-keys';
import { computePoleSummary, type PoleOverviewRow } from '@/modules/works-qa/utils/pole-overview';

// SLOT_META is a trusted in-code constant (no user input), so its column/key
// names are safe to interpolate. Returning a bounded `present_slots` array (≤22
// short keys) instead of the raw jsonb keeps this 30s-polled endpoint light.
const PRESENT_SLOTS_EXPR = `ARRAY_REMOVE(ARRAY[
        ${SLOT_META.map(s => `CASE WHEN ${s.dbColumn} IS NOT NULL THEN '${s.key}' END`).join(',\n        ')}
      ], NULL)`;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  const { project_id, pon_no } = req.query;
  if (!project_id || typeof project_id !== 'string') return apiResponse.badRequest(res, 'project_id required');

  try {
    const params: (string | number)[] = [project_id];
    let ponFilter = '';
    if (pon_no && typeof pon_no === 'string') {
      const ponNum = parseInt(pon_no, 10);
      if (isNaN(ponNum)) return apiResponse.badRequest(res, 'pon_no must be a number');
      params.push(ponNum);
      ponFilter = `AND pon_no = $${params.length}`;
    }

    const result = await pool.query(`
      SELECT
        id, pole_label, zone_no, pon_no, approved_at, slot_approvals,
        COALESCE(array_length(main_joint_tray_keys, 1), 0) AS tray_count,
        COALESCE(array_length(unassigned_photo_keys, 1), 0) AS unassigned_count,
        ${PRESENT_SLOTS_EXPR} AS present_slots,
        COALESCE(ARRAY(
          SELECT e.key FROM jsonb_each(COALESCE(vlm_results, '{}'::jsonb)) AS e(key, value)
           WHERE (e.value->>'valid')::boolean = false AND e.value->>'overridden_by' IS NULL
        ), '{}'::text[]) AS vlm_fail_keys,
        COALESCE((
          SELECT COUNT(*)::int
            FROM snags s
           WHERE s.pole_qa_photo_id = pole_qa_photos.id
             AND s.source = 'works_qa'
             AND s.status NOT IN ('verified','closed')
        ), 0) AS outstanding_snag_count,
        EXISTS (
          SELECT 1 FROM snags s
          WHERE s.pole_qa_photo_id = pole_qa_photos.id
            AND s.category = 'verification'
            AND s.status = 'open'
        ) AS has_open_verification_snag,
        EXISTS (
          SELECT 1 FROM snags s
          WHERE s.pole_qa_photo_id = pole_qa_photos.id
            AND s.category = 'verification'
            AND s.status = 'verified'
        ) AS has_verified_planted
      FROM pole_qa_photos
      WHERE project_id = $1::uuid ${ponFilter}
      ORDER BY pon_no ASC NULLS LAST, pole_label ASC
    `, params);

    const summaries = result.rows.map(r => computePoleSummary(r as PoleOverviewRow));
    return apiResponse.success(res, summaries);
  } catch (err) {
    log.error('works-qa/poles', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa', 'view')(handler));
