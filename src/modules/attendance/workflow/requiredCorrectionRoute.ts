import type { NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  ADJUSTMENT_HINTS,
  ABSOLUTE_MIN_REASON_CHARS,
} from '@/modules/attendance/corrections/hintCatalogue';
import type { AttendanceSession } from '@/modules/attendance/portal/types';
import {
  AttendanceCorrectionError,
  submitMissingClockOutCorrection,
} from './requiredActionQueries';

export async function handleRequiredCorrection(
  body: Record<string, unknown>,
  exceptionId: string,
  res: NextApiResponse,
  session: AttendanceSession,
): Promise<void> {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const minReason = Math.max(
    ADJUSTMENT_HINTS.forgot_clock_out.minReasonChars,
    ABSOLUTE_MIN_REASON_CHARS,
  );
  if (reason.length < minReason) {
    apiResponse.badRequest(res, `reason must be at least ${minReason} characters`);
    return;
  }
  const adjustedClockOutAt = parseDate(body.adjusted_clock_out_at);
  if (!adjustedClockOutAt) {
    apiResponse.badRequest(res, 'adjusted_clock_out_at must be a valid ISO timestamp');
    return;
  }

  try {
    const submitted = await submitMissingClockOutCorrection({
      staffId: session.staffId,
      exceptionId,
      adjustedClockOutAt,
      reason,
    });
    apiResponse.success(res, submitted);
  } catch (error) {
    if (error instanceof AttendanceCorrectionError) {
      if (error.code === 'not_found') {
        apiResponse.notFound(res, 'Attendance exception', exceptionId);
        return;
      }
      if (error.code === 'period_locked') {
        apiResponse.conflict(res, error.message, { reason: 'period_locked' });
        return;
      }
      if (error.code === 'already_submitted') {
        apiResponse.conflict(res, error.message, { reason: 'correction_already_submitted' });
        return;
      }
      apiResponse.badRequest(res, error.message, { reason: error.code });
      return;
    }
    log.error('[my-corrections] required correction failed', {
      exceptionId,
      staffId: session.staffId,
      error: error instanceof Error ? error.message : String(error),
    });
    apiResponse.internalError(res, error);
  }
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
