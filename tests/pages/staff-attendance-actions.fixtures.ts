import type { DayExceptionItem, DayExceptionListResult } from '@/modules/attendance/workflow/types';

export function item(overrides: Partial<DayExceptionItem> = {}): DayExceptionItem {
  return {
    id: '11111111-1111-4111-8111-111111111111', staffId: 'staff-1',
    staffName: 'Thabo Mokoena', workDate: '2026-07-31', kind: 'late_arrival',
    status: 'awaiting_supervisor', permittedActions: ['approve'], resultVersion: 4,
    queueOwnerUserId: null, createdAt: '2026-08-01T06:00:00.000Z',
    crewName: 'Crew Bravo', site: { id: 'site-1', name: 'Midrand Core' },
    evidence: {
      entryId: 'entry-1', clockInAt: '2026-07-31T06:12:00.000Z', clockOutAt: '2026-07-31T15:00:00.000Z',
      clockInGpsAvailable: true, clockOutGpsAvailable: false, selfies: [{ entryId: 'entry-1', kind: 'in' }],
    },
    adjustment: null,
    proposedHours: { regular: 7.8, overtime: 0, sunday: 0, holiday: 0 },
    dailyResult: {
      status: 'awaiting_supervisor', scheduledPaidHours: 8, recordedElapsedHours: 8.8,
      proposedHours: { regular: 7.8, overtime: 0, sunday: 0, holiday: 0, leave: 0, unpaid: 0 },
      approvedHours: null, attendanceClassification: null, blockingReasons: ['late_arrival'],
    },
    ...overrides,
  };
}

export function queue(
  items: DayExceptionItem[],
  scope: DayExceptionListResult['scope'] = { kind: 'scoped', staffCount: 3 },
  status: DayExceptionListResult['status'] = 'unresolved',
): DayExceptionListResult {
  return { items, limit: status === 'all' ? 200 : 50, status, scope };
}

export const allQueue = (items: DayExceptionItem[]) => (
  queue(items, { kind: 'scoped', staffCount: 3 }, 'all')
);

export const ok = (data: unknown): Response => (
  { ok: true, status: 200, json: async () => ({ success: true, data }) } as Response
);

export function resolvedItem(source = item()): DayExceptionItem {
  return {
    ...source,
    status: 'resolved',
    permittedActions: [],
    resultVersion: 5,
    dailyResult: {
      ...source.dailyResult,
      status: 'approved',
      approvedHours: source.dailyResult.proposedHours,
      blockingReasons: [],
    },
  };
}

export function persistedDecision(source: DayExceptionItem) {
  return {
    exception: {
      id: source.id, status: source.status, resultVersion: source.resultVersion,
      classification: source.dailyResult.attendanceClassification, resolutionReason: 'Approved after evidence review',
    },
    dailyResult: {
      staffId: source.staffId, workDate: source.workDate, status: source.dailyResult.status,
      resultVersion: source.resultVersion, approvedHours: source.dailyResult.approvedHours,
      attendanceClassification: source.dailyResult.attendanceClassification,
    },
    decisionEventId: 'event-1',
  };
}
