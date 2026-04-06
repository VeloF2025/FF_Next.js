/**
 * Zone/PON Options API
 * GET /api/snags/zone-pon-options?projectId=<id>
 * Returns distinct zone_no + pon_no pairs for cascading filter dropdowns.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET']);
  }

  try {
    const { projectId } = req.query;

    if (!projectId || typeof projectId !== 'string') {
      return apiResponse.success(res, { zones: [], pons: [] });
    }

    type RawRow = { zone_no: string | null; pon_no: string | null };

    const rows = await sql`
      SELECT DISTINCT
        COALESCE(pole.zone_no, dr.zone_no) AS zone_no,
        COALESCE(pole.pon_no, dr.pon_no) AS pon_no
      FROM snags s
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE s.project_id = ${projectId}
        AND (COALESCE(pole.zone_no, dr.zone_no) IS NOT NULL
             OR COALESCE(pole.pon_no, dr.pon_no) IS NOT NULL)
      ORDER BY zone_no ASC NULLS LAST, pon_no ASC NULLS LAST
    ` as RawRow[];

    const zoneSet = new Set<number>();
    const pons: Array<{ zone_no: number | null; pon_no: number | null }> = [];

    for (const r of rows) {
      const zn = r.zone_no !== null ? Number(r.zone_no) : null;
      const pn = r.pon_no !== null ? Number(r.pon_no) : null;
      if (zn !== null) zoneSet.add(zn);
      pons.push({ zone_no: zn, pon_no: pn });
    }

    const zones = Array.from(zoneSet).sort((a, b) => a - b);

    return apiResponse.success(res, { zones, pons });
  } catch (error) {
    log.error('Zone-PON options API error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
