import { query, type TxnClient } from '@/lib/db-pool';

import { type RequiredActionRow, toRequiredAction } from './requiredActionMapping';

export {
  AttendanceCorrectionError,
  submitMissingClockOutCorrection,
  type AttendanceCorrectionErrorCode,
  type SubmittedCorrection,
} from './requiredActionCorrection';

export interface RequiredAttendanceAction {
  exceptionId: string;
  entryId: string;
  workDate: string;
  kind: 'missing_clock_out';
  provisionalPaidHours: number;
  clockInAt: string;
}

export async function findRequiredAttendanceAction(
  staffId: string,
  today: string,
): Promise<RequiredAttendanceAction | null> {
  return findRequiredAttendanceActionWithReader(query, staffId, today);
}

export async function findRequiredAttendanceActionTxn(
  tx: TxnClient,
  staffId: string,
  today: string,
): Promise<RequiredAttendanceAction | null> {
  return findRequiredAttendanceActionWithReader(
    <T extends Record<string, unknown>>(text: string, params?: unknown[]) => tx.query<T>(text, params),
    staffId,
    today,
  );
}

async function findRequiredAttendanceActionWithReader(
  reader: <T extends Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>,
  staffId: string,
  today: string,
): Promise<RequiredAttendanceAction | null> {
  const rows = await reader<RequiredActionRow>(`
    SELECT de.id AS exception_id,
           de.entry_id,
           TO_CHAR(de.work_date, 'YYYY-MM-DD') AS work_date,
           de.kind,
           de.proposed_hours->>'proposedRegularHours' AS proposed_regular_hours,
           de.proposed_hours->>'proposedOvertimeHours' AS proposed_overtime_hours,
           de.proposed_hours->>'proposedSundayHours' AS proposed_sunday_hours,
           de.proposed_hours->>'proposedHolidayHours' AS proposed_holiday_hours,
           e.clock_in_at::text
    FROM attendance_day_exceptions de
    JOIN attendance_entries e
      ON e.id = de.entry_id
     AND e.staff_id = de.staff_id
    WHERE de.staff_id = $1::uuid
      AND de.work_date < $2::date
      AND de.kind = 'missing_clock_out'
      AND de.status = 'awaiting_worker'
      AND de.adjustment_id IS NULL
    ORDER BY de.work_date ASC, de.created_at ASC
    LIMIT 1`, [staffId, today]);
  return rows[0] ? toRequiredAction(rows[0]) : null;
}
