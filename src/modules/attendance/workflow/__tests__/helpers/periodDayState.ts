export interface PeriodDayState {
  staffId: string;
  workDate: string;
  status: 'approved' | 'locked';
  lockedPeriodVersion: number | null;
  resultVersion: number;
}

export function weekDays(week: string, status: 'approved' | 'locked' = 'approved', version = 1): PeriodDayState[] {
  const monday = new Date(`${week}T00:00:00Z`);
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(date.getUTCDate() + index);
    return {
      staffId: 'staff-1', workDate: date.toISOString().slice(0, 10), status,
      lockedPeriodVersion: status === 'locked' ? version : null, resultVersion: 1,
    };
  });
}

export function rowsForUpdate(
  rows: PeriodDayState[], from: string, to: string,
  status: 'approved' | 'locked', lockedVersion?: number,
): Record<string, unknown>[] {
  return rows.filter((row) => row.workDate >= from && row.workDate <= to &&
    row.status === status && (lockedVersion === undefined || row.lockedPeriodVersion === lockedVersion))
    .map((row) => ({
      staff_id: row.staffId, employee_id: 'EMP001', full_name: 'Alice Example',
      work_date: row.workDate, expected_day: true, result_version: row.resultVersion,
      schedule_policy_id: 'policy-1', approved_regular_hrs: row.workDate.endsWith('08') ? 5 : 8,
      approved_overtime_hrs: 0, approved_sunday_hrs: 0, approved_holiday_hrs: 0,
      leave_hrs: 0, unpaid_hrs: 0, attendance_classification: null,
      project_id: 'project-1', site_id: 'site-1', locked_period_version: row.lockedPeriodVersion,
    }));
}

export function transitionRows(rows: PeriodDayState[], params: unknown[]): number {
  const [from, to, nextStatus, nextLockedVersion, expectedStatus, expectedLockedVersion] = params;
  const matches = rows.filter((row) =>
    row.workDate >= String(from) && row.workDate <= String(to) &&
    row.status === expectedStatus &&
    (expectedLockedVersion == null || row.lockedPeriodVersion === Number(expectedLockedVersion)));
  for (const row of matches) {
    row.status = String(nextStatus) as PeriodDayState['status'];
    row.lockedPeriodVersion = nextLockedVersion == null ? null : Number(nextLockedVersion);
    row.resultVersion += 1;
  }
  return matches.length;
}
