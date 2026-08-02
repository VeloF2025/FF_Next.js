import { describe, expect, it } from 'vitest';

import {
  ATTENDANCE_ELIGIBILITY_MAX_AGE_MS,
  clearAttendanceEligibilitySnapshots,
  loadAttendanceEligibilitySnapshot,
  saveAttendanceEligibilitySnapshot,
} from '../attendanceEligibilitySnapshot';
import type { CurrentAttendanceResponse } from '../../attendanceStateApi';

const NOW = new Date('2026-08-04T08:00:00+02:00').getTime();
const STAFF = 'staff-1';
const current: CurrentAttendanceResponse = {
  workDate: '2026-08-04',
  open: null,
  schedule: {
    policyId: 'policy-1', timezone: 'Africa/Johannesburg', start: '08:00', end: '17:00',
    unpaidBreakMinutes: 60, scheduledPaidHours: 8,
  },
  result: { status: 'awaiting_worker', recordedElapsedHours: null, scheduledPaidHours: 8 },
  requiredAttendanceAction: {
    exceptionId: 'exception-1', entryId: 'entry-1', workDate: '2026-08-03',
    kind: 'missing_clock_out', provisionalPaidHours: 8, clockInAt: '2026-08-03T06:00:00Z',
  },
};

describe('versioned attendance eligibility snapshot', () => {
  it('preserves the unresolved-action block for a same-staff offline reload', () => {
    const storage = memoryStorage();
    saveAttendanceEligibilitySnapshot(STAFF, current, storage, NOW);
    expect(loadAttendanceEligibilitySnapshot(STAFF, storage, NOW + 1_000))
      .toEqual(current);
  });

  it.each([
    ['expired', NOW + ATTENDANCE_ELIGIBILITY_MAX_AGE_MS + 1, STAFF],
    ['different staff', NOW + 1_000, 'staff-2'],
    ['next SAST day', NOW + 16 * 60 * 60 * 1000, STAFF],
  ])('fails closed for %s snapshots', (_case, readAt, staffId) => {
    const storage = memoryStorage();
    saveAttendanceEligibilitySnapshot(STAFF, current, storage, NOW);
    expect(loadAttendanceEligibilitySnapshot(staffId, storage, readAt)).toBeNull();
  });

  it('fails closed for corrupt or unknown-version state', () => {
    const storage = memoryStorage();
    storage.setItem('ff:attendance-eligibility:v1:staff-1', '{bad json');
    expect(loadAttendanceEligibilitySnapshot(STAFF, storage, NOW)).toBeNull();
    storage.setItem('ff:attendance-eligibility:v1:staff-1', JSON.stringify({
      version: 99, staffId: STAFF, savedAt: NOW, attendance: current,
    }));
    expect(loadAttendanceEligibilitySnapshot(STAFF, storage, NOW)).toBeNull();
  });

  it('clears all staff eligibility snapshots on logout', () => {
    const storage = memoryStorage();
    saveAttendanceEligibilitySnapshot(STAFF, current, storage, NOW);
    saveAttendanceEligibilitySnapshot('staff-2', current, storage, NOW);
    storage.setItem('unrelated', 'keep');
    clearAttendanceEligibilitySnapshots(storage);
    expect(storage.length).toBe(1);
    expect(storage.getItem('unrelated')).toBe('keep');
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}
