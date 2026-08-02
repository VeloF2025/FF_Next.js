import type { WeeklyLockView } from './usePeriodReadiness';

interface LockResult {
  weekStartDate: string;
  version: number;
  active: boolean;
}

export function positiveLockVersion(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const version = typeof value === 'string' && value.trim() === '' ? Number.NaN : Number(value);
  return Number.isInteger(version) && version > 0 ? version : null;
}

export function confirmsLock(result: LockResult, rows: WeeklyLockView[]): boolean {
  const row = rows.find((candidate) => candidate.week_start_date === result.weekStartDate);
  const resultVersion = positiveLockVersion(result.version);
  if (!row || resultVersion === null || positiveLockVersion(row.lock_version) !== resultVersion) return false;
  return result.active ? row.unlocked_at === null : row.unlocked_at !== null;
}

export function confirmsBulkLocks(
  weeks: string[], before: Map<string, number>, rows: WeeklyLockView[], expectedReason: string,
): boolean {
  return weeks.every((week) => {
    const row = rows.find((candidate) => candidate.week_start_date === week);
    const version = positiveLockVersion(row?.lock_version);
    return Boolean(row && row.unlocked_at === null && version === before.get(week)! + 1 &&
      row.latest_reason === expectedReason &&
      (row.latest_action === 'lock' || row.latest_action === 'relock'));
  });
}
