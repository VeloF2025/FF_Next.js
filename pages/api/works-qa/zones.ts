import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

interface PonRow {
  zone_no: number | null;
  pon_no: number;
  pole_count: number;
  approved_count: number;
  ready_count: number;
}

interface ZoneOut {
  zone_no: number | null;
  pon_count: number;
  pole_count: number;
  approved_count: number;
  pons: { pon_no: number; pole_count: number; approved_count: number; ready_count: number }[];
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  const { project_id } = req.query;
  if (!project_id || typeof project_id !== 'string') {
    return apiResponse.badRequest(res, 'project_id required');
  }

  try {
    const result = await pool.query<PonRow>(`
      WITH pole_pool AS (
        SELECT DISTINCT q.zone_no, q.pon_no, q.feature_id AS pole_label, NULL::timestamptz AS approved_at
        FROM qfield_photo_validations q
        INNER JOIN qfield_project_links l ON l.qfield_project_id = q.project_id
        WHERE l.fibreflow_project_id = $1::uuid
          AND q.feature_type = 'pole'
          AND q.pon_no IS NOT NULL
        UNION
        SELECT DISTINCT zone_no, pon_no, pole_label, approved_at
        FROM pole_qa_photos
        WHERE project_id = $1::uuid
          AND pon_no IS NOT NULL
      ),
      pole_dedup AS (
        SELECT
          zone_no,
          pon_no,
          pole_label,
          MAX(approved_at) AS approved_at
        FROM pole_pool
        GROUP BY zone_no, pon_no, pole_label
      )
      SELECT
        zone_no,
        pon_no,
        COUNT(DISTINCT pole_label)::int                                AS pole_count,
        COUNT(DISTINCT pole_label) FILTER (WHERE approved_at IS NOT NULL)::int AS approved_count,
        0::int                                                          AS ready_count
      FROM pole_dedup
      GROUP BY zone_no, pon_no
      ORDER BY zone_no NULLS LAST, pon_no ASC
    `, [project_id]);

    const grouped = new Map<number | null, ZoneOut>();
    for (const row of result.rows) {
      const key = row.zone_no;
      let zone = grouped.get(key);
      if (!zone) {
        zone = { zone_no: key, pon_count: 0, pole_count: 0, approved_count: 0, pons: [] };
        grouped.set(key, zone);
      }
      zone.pons.push({
        pon_no: row.pon_no,
        pole_count: row.pole_count,
        approved_count: row.approved_count,
        ready_count: row.ready_count,
      });
      zone.pon_count += 1;
      zone.pole_count += row.pole_count;
      zone.approved_count += row.approved_count;
    }

    return apiResponse.success(res, Array.from(grouped.values()));
  } catch (err) {
    log.error('works-qa/zones', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
