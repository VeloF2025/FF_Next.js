import {
  isCurrentAttendanceResponse,
  type CurrentAttendanceResponse,
} from '../attendanceStateApi';

const SNAPSHOT_VERSION = 1;
const STORAGE_PREFIX = 'ff:attendance-eligibility:v1:';
export const ATTENDANCE_ELIGIBILITY_MAX_AGE_MS = 15 * 60 * 1000;

interface EligibilitySnapshot {
  version: typeof SNAPSHOT_VERSION;
  staffId: string;
  savedAt: number;
  attendance: CurrentAttendanceResponse;
}

export function saveAttendanceEligibilitySnapshot(
  staffId: string,
  attendance: CurrentAttendanceResponse,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
  now = Date.now(),
): void {
  if (!staffId || !isCurrentAttendanceResponse(attendance)) return;
  const snapshot: EligibilitySnapshot = {
    version: SNAPSHOT_VERSION,
    staffId,
    savedAt: now,
    attendance,
  };
  try {
    storage.setItem(key(staffId), JSON.stringify(snapshot));
  } catch {
    // Storage can be unavailable in hardened/private browsers. The caller
    // remains online-only and therefore fails closed when offline.
  }
}

export function loadAttendanceEligibilitySnapshot(
  staffId: string,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
  now = Date.now(),
): CurrentAttendanceResponse | null {
  let raw: string | null;
  try {
    raw = storage.getItem(key(staffId));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const snapshot = JSON.parse(raw) as Partial<EligibilitySnapshot>;
    const age = now - Number(snapshot.savedAt);
    if (snapshot.version !== SNAPSHOT_VERSION || snapshot.staffId !== staffId ||
        !Number.isFinite(age) || age < 0 || age > ATTENDANCE_ELIGIBILITY_MAX_AGE_MS ||
        !isCurrentAttendanceResponse(snapshot.attendance) ||
        snapshot.attendance.workDate !== sastDate(now)) {
      return null;
    }
    return snapshot.attendance;
  } catch {
    return null;
  }
}

export function clearAttendanceEligibilitySnapshots(
  storage: Pick<Storage, 'length' | 'key' | 'removeItem'> = window.localStorage,
): void {
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((value): value is string => Boolean(value?.startsWith(STORAGE_PREFIX)));
    keys.forEach((value) => storage.removeItem(value));
  } catch {
    // Best-effort logout hygiene; the server session remains authoritative.
  }
}

function key(staffId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(staffId)}`;
}

function sastDate(now: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(now));
}
