import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { AttendanceSession } from '@/modules/attendance/portal/types';
import { findCorrectionTarget } from './correctionEligibility';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const target = await findCorrectionTarget(session.staffId, exceptionId);
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
