/**
 * API: /api/activate/serial-history
 *
 * GET /api/activate/serial-history?dropNumber=DR123456
 * Returns serial change history for a DR
 *
 * GET /api/activate/serial-history/recent?limit=50
 * Returns recent serial changes across all DRs
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { withErrorHandler } from '@/lib/api-error-handler';
import { getSerialHistory } from '@/modules/activate/services/activityLogService';
import { sql } from '@/lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const { dropNumber, recent, limit = '50', project } = req.query;

  // Recent changes across all DRs
  if (recent === 'true') {
    const limitNum = Math.min(parseInt(limit as string) || 50, 200);

    let projectFilter = '';
    const params: (string | number)[] = [limitNum];

    if (project && typeof project === 'string') {
      projectFilter = 'AND u.project = $2';
      params.push(project);
    }

    const recentChanges = await sql`
      SELECT
        sch.id,
        sch.drop_number,
        sch.change_type,
        sch.old_value,
        sch.new_value,
        sch.change_source,
        sch.change_reason,
        sch.actor,
        sch.metadata,
        sch.detected_at,
        u.project
      FROM serial_change_history sch
      LEFT JOIN dr_photo_unified_reviews u ON sch.drop_number = u.drop_number
      ${project ? sql`WHERE u.project = ${project}` : sql``}
      ORDER BY sch.detected_at DESC
      LIMIT ${limitNum}
    `;

    // Summary stats
    const stats = await sql`
      SELECT
        COUNT(*) as total_changes,
        COUNT(CASE WHEN change_type = 'ont_serial' THEN 1 END) as ont_changes,
        COUNT(CASE WHEN change_type = 'ups_serial' THEN 1 END) as ups_changes,
        COUNT(CASE WHEN metadata->>'swap_detected' = 'true' THEN 1 END) as swaps_detected,
        COUNT(CASE WHEN old_value IS NULL THEN 1 END) as initial_captures,
        COUNT(DISTINCT drop_number) as unique_drs
      FROM serial_change_history
      WHERE detected_at > NOW() - INTERVAL '7 days'
    `;

    return apiResponse.success(res, {
      mode: 'recent',
      changes: recentChanges,
      stats: stats[0] || {},
      limit: limitNum,
    });
  }

  // History for specific DR
  if (!dropNumber || typeof dropNumber !== 'string') {
    return apiResponse.badRequest(res, 'dropNumber query parameter is required');
  }

  const limitNum = Math.min(parseInt(limit as string) || 50, 100);
  const history = await getSerialHistory(dropNumber, limitNum);

  // Get current serials for comparison
  const currentSerials = await sql`
    SELECT
      ont_serial_scanned as current_ont,
      ups_serial_scanned as current_ups,
      serial_swap_detected,
      serial_swap_status
    FROM dr_photo_unified_reviews
    WHERE drop_number = ${dropNumber}
  `;

  const current = currentSerials[0] || {};

  // Summary for this DR
  const summary = {
    total_changes: history.length,
    ont_changes: history.filter((h) => h.change_type === 'ont_serial').length,
    ups_changes: history.filter((h) => h.change_type === 'ups_serial').length,
    swaps_detected: history.filter((h) => h.metadata?.swap_detected).length,
    first_recorded: history.length > 0 ? history[history.length - 1].detected_at : null,
    last_change: history.length > 0 ? history[0].detected_at : null,
  };

  return apiResponse.success(res, {
    dropNumber,
    current,
    history,
    summary,
  });
}

export default withAuth(withErrorHandler(handler));
