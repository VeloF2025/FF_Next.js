import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { log } from '@/lib/logger';

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
        id, pole_label, zone_no, pon_no,
        (civil_step_01_key IS NOT NULL)::int + (civil_step_02_key IS NOT NULL)::int +
        (civil_step_03_key IS NOT NULL)::int + (civil_step_04_key IS NOT NULL)::int +
        (civil_step_05_key IS NOT NULL)::int + (civil_step_06_key IS NOT NULL)::int +
        (civil_step_07_key IS NOT NULL)::int AS civil_filled,
        (optical_dome_01_key IS NOT NULL)::int + (optical_dome_02_key IS NOT NULL)::int +
        (optical_dome_03_key IS NOT NULL)::int + (optical_dome_04_key IS NOT NULL)::int +
        (optical_dome_05_key IS NOT NULL)::int + (optical_dome_06_key IS NOT NULL)::int +
        (optical_dome_07_key IS NOT NULL)::int + (optical_dome_08_key IS NOT NULL)::int AS dome_filled,
        (main_joint_11_key IS NOT NULL)::int + (main_joint_12_key IS NOT NULL)::int +
        (main_joint_13_key IS NOT NULL)::int + (main_joint_14_key IS NOT NULL)::int +
        (main_joint_15_key IS NOT NULL)::int + (main_joint_16_key IS NOT NULL)::int AS joint_filled,
        COALESCE(array_length(main_joint_tray_keys, 1), 0) AS tray_count,
        (SELECT count(*) FROM jsonb_each(vlm_results) WHERE (value->>'valid')::boolean = false AND value->>'overridden_by' IS NULL) AS vlm_failures,
        CASE
          WHEN approved_at IS NOT NULL THEN 'approved'
          WHEN (
            civil_step_01_key IS NOT NULL OR civil_step_02_key IS NOT NULL OR
            civil_step_03_key IS NOT NULL OR civil_step_04_key IS NOT NULL OR
            civil_step_05_key IS NOT NULL OR civil_step_06_key IS NOT NULL OR
            civil_step_07_key IS NOT NULL OR
            optical_dome_01_key IS NOT NULL OR optical_dome_02_key IS NOT NULL OR
            optical_dome_03_key IS NOT NULL OR optical_dome_04_key IS NOT NULL OR
            optical_dome_05_key IS NOT NULL OR optical_dome_06_key IS NOT NULL OR
            optical_dome_07_key IS NOT NULL OR optical_dome_08_key IS NOT NULL OR
            main_joint_11_key IS NOT NULL OR main_joint_12_key IS NOT NULL OR
            main_joint_13_key IS NOT NULL OR main_joint_14_key IS NOT NULL OR
            main_joint_15_key IS NOT NULL OR main_joint_16_key IS NOT NULL OR
            array_length(main_joint_tray_keys, 1) >= 1
          ) THEN
            CASE WHEN (
              civil_step_01_key IS NOT NULL AND civil_step_02_key IS NOT NULL AND
              civil_step_03_key IS NOT NULL AND civil_step_04_key IS NOT NULL AND
              civil_step_05_key IS NOT NULL AND civil_step_06_key IS NOT NULL AND
              civil_step_07_key IS NOT NULL AND
              optical_dome_01_key IS NOT NULL AND optical_dome_02_key IS NOT NULL AND
              optical_dome_03_key IS NOT NULL AND optical_dome_04_key IS NOT NULL AND
              optical_dome_05_key IS NOT NULL AND optical_dome_06_key IS NOT NULL AND
              optical_dome_07_key IS NOT NULL AND optical_dome_08_key IS NOT NULL AND
              main_joint_11_key IS NOT NULL AND main_joint_12_key IS NOT NULL AND
              main_joint_13_key IS NOT NULL AND main_joint_14_key IS NOT NULL AND
              main_joint_15_key IS NOT NULL AND main_joint_16_key IS NOT NULL AND
              array_length(main_joint_tray_keys, 1) >= 1
            ) AND (SELECT count(*) FROM jsonb_each(vlm_results) WHERE (value->>'valid')::boolean = false AND value->>'overridden_by' IS NULL) = 0
            THEN 'ready' ELSE 'in_progress' END
          ELSE 'empty'
        END AS status,
        approved_at,
        COALESCE((
          SELECT COUNT(*)::int
            FROM snags s
           WHERE s.pole_qa_photo_id = pole_qa_photos.id
             AND s.source = 'works_qa'
             AND s.status NOT IN ('verified','closed')
        ), 0) AS outstanding_snag_count
      FROM pole_qa_photos
      WHERE project_id = $1::uuid ${ponFilter}
      ORDER BY pon_no ASC NULLS LAST, pole_label ASC
    `, params);

    return apiResponse.success(res, result.rows);
  } catch (err) {
    log.error('works-qa/poles', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa', 'view')(handler));
