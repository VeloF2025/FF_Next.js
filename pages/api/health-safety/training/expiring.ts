/**
 * H&S Expiring / Expired Training Dashboard API
 *
 * GET /api/health-safety/training/expiring?window=30
 *
 * Lists worker training that is expired or expiring within `window` days (the
 * competency gaps someone must act on), plus a per-contractor rollup.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { EXPIRING_SOON_DAYS } from '@/modules/health-safety/types/training.types';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const windowRaw = parseInt((req.query.window as string) || String(EXPIRING_SOON_DAYS), 10);
    const windowDays = Number.isFinite(windowRaw) && windowRaw > 0 ? windowRaw : EXPIRING_SOON_DAYS;

    // Expired or expiring within the window, worst first.
    const items = await sql`
      SELECT
        wt.id, wt.worker_name, wt.contractor_id, wt.staff_id, wt.team_member_id,
        wt.expiry_date, wt.certificate_number,
        (wt.expiry_date - CURRENT_DATE) AS days_to_expiry,
        tt.name AS training_name, tt.code AS training_code, tt.is_statutory,
        c.company_name AS contractor_name,
        CASE WHEN wt.expiry_date < CURRENT_DATE THEN 'expired' ELSE 'expiring_soon' END AS competency_status
      FROM hs_worker_training wt
      JOIN hs_training_types tt ON tt.id = wt.training_type_id
      LEFT JOIN contractors c ON c.id = wt.contractor_id
      WHERE wt.expiry_date IS NOT NULL
        AND wt.expiry_date <= CURRENT_DATE + make_interval(days => ${windowDays})
      ORDER BY wt.expiry_date ASC
    `;

    const [summary] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE wt.expiry_date < CURRENT_DATE)::int AS expired,
        COUNT(*) FILTER (
          WHERE wt.expiry_date >= CURRENT_DATE
            AND wt.expiry_date <= CURRENT_DATE + make_interval(days => ${windowDays})
        )::int AS expiring_soon,
        COUNT(*) FILTER (
          WHERE wt.expiry_date < CURRENT_DATE AND tt.is_statutory
        )::int AS expired_statutory
      FROM hs_worker_training wt
      JOIN hs_training_types tt ON tt.id = wt.training_type_id
      WHERE wt.expiry_date IS NOT NULL
        AND wt.expiry_date <= CURRENT_DATE + make_interval(days => ${windowDays})
    `;

    return apiResponse.success(res, {
      window_days: windowDays,
      items,
      summary: summary ?? { expired: 0, expiring_soon: 0, expired_statutory: 0 },
    });
  } catch (error) {
    log.error('[H&S Training Expiring API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
