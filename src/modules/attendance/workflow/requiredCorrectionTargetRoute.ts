import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { query } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import type { AttendanceSession } from '@/modules/attendance/portal/types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CorrectionTargetRow extends Record<string, unknown> {
  exception_id: string;
  entry_id: string;
}

export async function handleRequiredCorrectionTarget(
  req: NextApiRequest,
  res: NextApiResponse,
  session: AttendanceSession,
): Promise<boolean> {
  if (req.query.exception_id === undefined) return false;
  const exceptionId = req.query.exception_id;
  if (typeof exceptionId !== 'string' || !UUID_PATTERN.test(exceptionId)) {
    apiResponse.badRequest(res, 'exception_id must be a UUID');
    return true;
  }

  try {
    const rows = await query<CorrectionTargetRow>(`
      SELECT de.id::text AS exception_id, de.entry_id::text AS entry_id
      FROM attendance_day_exceptions de
      JOIN attendance_entries e
        ON e.id = de.entry_id AND e.staff_id = de.staff_id
      JOIN attendance_daily_summaries ds
        ON ds.staff_id = de.staff_id AND ds.work_date = de.work_date
      WHERE de.id = $2::uuid
        AND de.staff_id = $1::uuid
        AND de.kind = 'missing_clock_out'
        AND de.status = 'awaiting_worker'
        AND de.adjustment_id IS NULL
        AND de.resolved_at IS NULL
        AND de.entry_id IS NOT NULL
        AND e.clock_out_at IS NULL
        AND ds.result_version = de.result_version
      LIMIT 1`, [session.staffId, exceptionId]);
    const target = rows[0];
    if (!target) {
      apiResponse.notFound(res, 'Attendance correction', exceptionId);
      return true;
    }
    apiResponse.success(res, {
      correctionTarget: { exceptionId: target.exception_id, entryId: target.entry_id },
    });
  } catch (error) {
    log.error('[my-corrections] target lookup failed', {
      staffId: session.staffId,
      exceptionId,
      error: error instanceof Error ? error.message : String(error),
    });
    apiResponse.internalError(res, error);
  }
  return true;
}
