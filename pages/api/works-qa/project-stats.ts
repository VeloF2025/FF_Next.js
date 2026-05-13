import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

interface ProjectStatsRow {
  project_id: string;
  project_name: string;
  project_code: string | null;
  total: number;
  approved: number;
  ready: number;
  in_progress: number;
  empty: number;
  pending_vlm: number;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  try {
    const result = await pool.query<ProjectStatsRow>(`
      WITH pole_universe AS (
        SELECT DISTINCT project_id, feature_id AS pole_label
        FROM qfield_photo_validations
        WHERE feature_type = 'pole'
        UNION
        SELECT DISTINCT project_id, pole_label
        FROM pole_qa_photos
      ),
      pole_status AS (
        SELECT
          u.project_id,
          u.pole_label,
          CASE
            WHEN qa.approved_at IS NOT NULL THEN 'approved'
            WHEN qa.id IS NULL THEN 'empty'
            WHEN (
              qa.civil_step_01_key IS NOT NULL AND qa.civil_step_02_key IS NOT NULL AND
              qa.civil_step_03_key IS NOT NULL AND qa.civil_step_04_key IS NOT NULL AND
              qa.civil_step_05_key IS NOT NULL AND qa.civil_step_06_key IS NOT NULL AND
              qa.civil_step_07_key IS NOT NULL AND
              qa.optical_dome_01_key IS NOT NULL AND qa.optical_dome_02_key IS NOT NULL AND
              qa.optical_dome_03_key IS NOT NULL AND qa.optical_dome_04_key IS NOT NULL AND
              qa.optical_dome_05_key IS NOT NULL AND qa.optical_dome_06_key IS NOT NULL AND
              qa.optical_dome_07_key IS NOT NULL AND qa.optical_dome_08_key IS NOT NULL AND
              qa.optical_joint_11_key IS NOT NULL AND qa.optical_joint_12_key IS NOT NULL AND
              qa.optical_joint_13_key IS NOT NULL AND qa.optical_joint_14_key IS NOT NULL AND
              qa.optical_joint_15_key IS NOT NULL AND qa.optical_joint_16_key IS NOT NULL AND
              array_length(qa.optical_joint_tray_keys, 1) >= 1 AND
              (SELECT COUNT(*) FROM jsonb_each(qa.vlm_results)
                 WHERE (value->>'valid')::boolean = false
                   AND value->>'overridden_by' IS NULL) = 0
            ) THEN 'ready'
            WHEN (
              qa.civil_step_01_key IS NOT NULL OR qa.civil_step_02_key IS NOT NULL OR
              qa.civil_step_03_key IS NOT NULL OR qa.civil_step_04_key IS NOT NULL OR
              qa.civil_step_05_key IS NOT NULL OR qa.civil_step_06_key IS NOT NULL OR
              qa.civil_step_07_key IS NOT NULL OR
              qa.optical_dome_01_key IS NOT NULL OR qa.optical_dome_02_key IS NOT NULL OR
              qa.optical_dome_03_key IS NOT NULL OR qa.optical_dome_04_key IS NOT NULL OR
              qa.optical_dome_05_key IS NOT NULL OR qa.optical_dome_06_key IS NOT NULL OR
              qa.optical_dome_07_key IS NOT NULL OR qa.optical_dome_08_key IS NOT NULL OR
              qa.optical_joint_11_key IS NOT NULL OR qa.optical_joint_12_key IS NOT NULL OR
              qa.optical_joint_13_key IS NOT NULL OR qa.optical_joint_14_key IS NOT NULL OR
              qa.optical_joint_15_key IS NOT NULL OR qa.optical_joint_16_key IS NOT NULL OR
              array_length(qa.optical_joint_tray_keys, 1) >= 1
            ) THEN 'in_progress'
            ELSE 'empty'
          END AS status,
          COALESCE(
            (SELECT COUNT(*) FROM jsonb_each(COALESCE(qa.vlm_results, '{}'::jsonb))
               WHERE (value->>'valid')::boolean = false
                 AND value->>'overridden_by' IS NULL),
            0
          )::int AS pending_vlm_failures
        FROM pole_universe u
        LEFT JOIN pole_qa_photos qa
          ON qa.project_id = u.project_id AND qa.pole_label = u.pole_label
      )
      SELECT
        p.id            AS project_id,
        p.project_name  AS project_name,
        p.project_code  AS project_code,
        COUNT(s.pole_label)::int                                              AS total,
        COUNT(*) FILTER (WHERE s.status = 'approved')::int                    AS approved,
        COUNT(*) FILTER (WHERE s.status = 'ready')::int                       AS ready,
        COUNT(*) FILTER (WHERE s.status = 'in_progress')::int                 AS in_progress,
        COUNT(*) FILTER (WHERE s.status = 'empty')::int                       AS empty,
        COALESCE(SUM(s.pending_vlm_failures), 0)::int                         AS pending_vlm
      FROM pole_status s
      INNER JOIN projects p ON p.id = s.project_id
      GROUP BY p.id, p.project_name, p.project_code
      ORDER BY p.project_name ASC
    `);

    return apiResponse.success(res, result.rows);
  } catch (err) {
    log.error('works-qa/project-stats', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
