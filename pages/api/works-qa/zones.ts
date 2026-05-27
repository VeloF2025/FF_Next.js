import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { log } from '@/lib/logger';

interface PonRow {
  zone_no: number | null;
  pon_no: number;
  pole_count: number;
  approved_count: number;
  outstanding_snag_count: number;
}

interface ZoneOut {
  zone_no: number | null;
  pon_count: number;
  pole_count: number;
  approved_count: number;
  outstanding_snag_count: number;
  pons: { pon_no: number; pole_count: number; approved_count: number; outstanding_snag_count: number }[];
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  const { project_id } = req.query;
  if (!project_id || typeof project_id !== 'string') {
    return apiResponse.badRequest(res, 'project_id required');
  }

  try {
    // Source of zone/PON metadata is sow_poles (FibreFlow IDs).
    // pole_qa_photos may carry zone/PON copied at sync time too — merge in case sync ran
    // and added rows that aren't in the SoW (manual additions).
    // outstanding_snag_count groups open works-qa snags by the photo's
    // (zone_no, pon_no) — joining on both keys avoids fan-out if a pon_no
    // ever appears under multiple zones in pole_qa_photos (no DB constraint
    // guarantees uniqueness on pon_no alone). Filter predicate mirrors
    // photoSnagHelpers.findOpenSnagForSlot so the count stays consistent
    // with the idempotency rule (verified/closed = resolved).
    const result = await pool.query<PonRow>(`
      WITH pole_pool AS (
        SELECT zone_no, pon_no, pole_number AS pole_label, NULL::timestamptz AS approved_at
        FROM sow_poles
        WHERE project_id = $1::uuid
          AND pon_no IS NOT NULL
        UNION
        SELECT zone_no, pon_no, pole_label, approved_at
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
      ),
      snag_counts AS (
        SELECT pqp.zone_no, pqp.pon_no, COUNT(*)::int AS outstanding_snag_count
          FROM snags s
          JOIN pole_qa_photos pqp ON pqp.id = s.pole_qa_photo_id
         WHERE pqp.project_id = $1::uuid
           AND s.source = 'works_qa'
           AND s.status NOT IN ('verified','closed')
         GROUP BY pqp.zone_no, pqp.pon_no
      )
      SELECT
        pd.zone_no,
        pd.pon_no,
        COUNT(DISTINCT pd.pole_label)::int                                AS pole_count,
        COUNT(DISTINCT pd.pole_label) FILTER (WHERE pd.approved_at IS NOT NULL)::int AS approved_count,
        COALESCE(sc.outstanding_snag_count, 0)::int                       AS outstanding_snag_count
      FROM pole_dedup pd
      LEFT JOIN snag_counts sc
        ON sc.pon_no = pd.pon_no
       AND sc.zone_no IS NOT DISTINCT FROM pd.zone_no
      GROUP BY pd.zone_no, pd.pon_no, sc.outstanding_snag_count
      ORDER BY pd.zone_no NULLS LAST, pd.pon_no ASC
    `, [project_id]);

    const grouped = new Map<number | null, ZoneOut>();
    for (const row of result.rows) {
      const key = row.zone_no;
      let zone = grouped.get(key);
      if (!zone) {
        zone = {
          zone_no: key,
          pon_count: 0,
          pole_count: 0,
          approved_count: 0,
          outstanding_snag_count: 0,
          pons: [],
        };
        grouped.set(key, zone);
      }
      zone.pons.push({
        pon_no: row.pon_no,
        pole_count: row.pole_count,
        approved_count: row.approved_count,
        outstanding_snag_count: row.outstanding_snag_count,
      });
      zone.pon_count += 1;
      zone.pole_count += row.pole_count;
      zone.approved_count += row.approved_count;
      zone.outstanding_snag_count += row.outstanding_snag_count;
    }

    return apiResponse.success(res, Array.from(grouped.values()));
  } catch (err) {
    log.error('works-qa/zones', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa', 'view')(handler));
