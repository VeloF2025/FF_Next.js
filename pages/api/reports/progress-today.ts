/**
 * API Route: /api/reports/progress-today
 *
 * Purpose: Get today's progress metrics for the executive dashboard
 * Method: GET
 *
 * Returns:
 * - polesPlanted: Poles with installation_date = today
 * - stringingCompleted: Fiber stringing sections completed today
 * - rfosCompleted: PON stages reaching 'rfo' overall_stage today
 * - atpsCompleted: ATP tests passed today (pon_stage_tracking)
 * - totalInstalls: DR installs submitted today (dr_photo_unified_reviews)
 * - totalActivated: OES activations today (day-lagged from FiberTime)
 * - asOfDate: ISO date string for "today"
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const getSql = () => neon(process.env.DATABASE_URL!);

export interface ProgressTodayResponse {
  asOfDate: string;
  metrics: {
    polesPlanted: number;
    stringingCompleted: number;
    rfosCompleted: number;
    atpsCompleted: number;
    totalInstalls: number;
    totalActivated: number;
  };
  previousDay: {
    polesPlanted: number;
    stringingCompleted: number;
    rfosCompleted: number;
    atpsCompleted: number;
    totalInstalls: number;
    totalActivated: number;
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const sql = getSql();

    // All queries run in parallel for speed
    const [
      polesToday,
      polesYesterday,
      stringingToday,
      stringingYesterday,
      rfosToday,
      rfosYesterday,
      atpsToday,
      atpsYesterday,
      installsToday,
      installsYesterday,
      activatedToday,
      activatedYesterday,
    ] = await Promise.all([
      // Poles planted today
      sql`SELECT COUNT(*) as count FROM poles WHERE installation_date = CURRENT_DATE`,
      sql`SELECT COUNT(*) as count FROM poles WHERE installation_date = CURRENT_DATE - INTERVAL '1 day'`,

      // Stringing completed today
      sql`SELECT COUNT(*) as count FROM fiber_stringing WHERE completion_date = CURRENT_DATE`,
      sql`SELECT COUNT(*) as count FROM fiber_stringing WHERE completion_date = CURRENT_DATE - INTERVAL '1 day'`,

      // RFOs completed today — PON stages that reached RFO stage today
      sql`SELECT COUNT(*) as count FROM pon_stage_tracking WHERE overall_stage = 'rfo' AND updated_at::date = CURRENT_DATE`,
      sql`SELECT COUNT(*) as count FROM pon_stage_tracking WHERE overall_stage = 'rfo' AND updated_at::date = CURRENT_DATE - INTERVAL '1 day'`,

      // ATPs completed today
      sql`SELECT COUNT(*) as count FROM pon_stage_tracking WHERE atp_last_date = CURRENT_DATE`,
      sql`SELECT COUNT(*) as count FROM pon_stage_tracking WHERE atp_last_date = CURRENT_DATE - INTERVAL '1 day'`,

      // Total installs today (DR submissions via WhatsApp)
      sql`SELECT COUNT(*) as count FROM dr_photo_unified_reviews WHERE submitted_date::date = CURRENT_DATE`,
      sql`SELECT COUNT(*) as count FROM dr_photo_unified_reviews WHERE submitted_date::date = CURRENT_DATE - INTERVAL '1 day'`,

      // OES Activations (day-lagged — imported from FiberTime OES report)
      sql`SELECT COUNT(*) as count FROM oes_activations WHERE activation_date::date = CURRENT_DATE`,
      sql`SELECT COUNT(*) as count FROM oes_activations WHERE activation_date::date = CURRENT_DATE - INTERVAL '1 day'`,
    ]);

    const response: ProgressTodayResponse = {
      asOfDate: new Date().toISOString().split('T')[0],
      metrics: {
        polesPlanted: Number(polesToday[0]!.count),
        stringingCompleted: Number(stringingToday[0]!.count),
        rfosCompleted: Number(rfosToday[0]!.count),
        atpsCompleted: Number(atpsToday[0]!.count),
        totalInstalls: Number(installsToday[0]!.count),
        totalActivated: Number(activatedToday[0]!.count),
      },
      previousDay: {
        polesPlanted: Number(polesYesterday[0]!.count),
        stringingCompleted: Number(stringingYesterday[0]!.count),
        rfosCompleted: Number(rfosYesterday[0]!.count),
        atpsCompleted: Number(atpsYesterday[0]!.count),
        totalInstalls: Number(installsYesterday[0]!.count),
        totalActivated: Number(activatedYesterday[0]!.count),
      },
    };

    log.info('Fetched progress metrics', { error: response.metrics }, 'ProgressTodayAPI');
    return res.status(200).json(response);
  } catch (error) {
    log.error('Failed to fetch progress metrics', { error: { error } }, 'ProgressTodayAPI');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
