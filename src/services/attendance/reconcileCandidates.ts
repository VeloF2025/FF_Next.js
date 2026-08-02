import type { ExpectedAttendanceDay, ReconciliationEntryRow } from './reconcileQueries';

export interface DayCandidate {
  staffId: string;
  workDate: string;
  isPublicHoliday: boolean;
  entry: ReconciliationEntryRow | null;
  calculationFingerprint: string | null;
  resultVersion: string | number | null;
}

export function buildCandidates(
  expectedDays: ExpectedAttendanceDay[],
  entries: ReconciliationEntryRow[],
  publicHolidays: Set<string>,
): { candidates: DayCandidate[]; duplicateKeys: string[] } {
  const days = new Map<string, DayCandidate>();
  for (const day of expectedDays) {
    days.set(dayKey(day.staff_id, day.work_date), {
      staffId: day.staff_id, workDate: day.work_date, isPublicHoliday: day.is_public_holiday,
      entry: null, calculationFingerprint: day.calculation_fingerprint, resultVersion: day.result_version,
    });
  }
  const duplicates = new Set<string>();
  for (const entry of entries) {
    const key = dayKey(entry.staff_id, entry.work_date);
    const existing = days.get(key);
    if (existing?.entry) duplicates.add(key);
    days.set(key, {
      staffId: entry.staff_id, workDate: entry.work_date,
      isPublicHoliday: existing?.isPublicHoliday ?? publicHolidays.has(entry.work_date), entry,
      calculationFingerprint: entry.calculation_fingerprint, resultVersion: entry.result_version,
    });
  }
  const candidates = [...days.values()].sort((a, b) =>
    a.staffId.localeCompare(b.staffId) || a.workDate.localeCompare(b.workDate));
  return { candidates, duplicateKeys: [...duplicates].sort() };
}

export function evidenceFor(day: DayCandidate) {
  const row = day.entry;
  return {
    workDate: day.workDate,
    clockInAt: row ? new Date(row.clock_in_at) : null,
    clockOutAt: row?.clock_out_at ? new Date(row.clock_out_at) : null,
    clockOutSource: row?.status === 'auto_closed' ? 'system' as const
      : row?.status === 'manual' ? 'manual' as const
        : row?.clock_out_at ? 'device' as const : null,
  };
}

export function dayKey(staffId: string, workDate: string): string {
  return `${staffId}:${workDate}`;
}
