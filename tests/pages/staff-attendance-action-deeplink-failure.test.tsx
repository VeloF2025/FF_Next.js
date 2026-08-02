/** @vitest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { DayExceptionItem, DayExceptionListResult } from '@/modules/attendance/workflow/types';

const mocks = vi.hoisted(() => ({
  router: {
    pathname: '/staff/attendance/corrections', query: { exception_id: 'missing-exception' },
    replace: vi.fn(), push: vi.fn(),
  },
}));
vi.mock('next/router', () => ({ useRouter: () => mocks.router }));
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/attendance/AttendanceNav', () => ({ AttendanceNav: () => <nav>Attendance</nav> }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import StaffAttendanceActionsPage from '../../pages/staff/attendance/corrections';

const unrelated: DayExceptionItem = {
  id: '11111111-1111-4111-8111-111111111111', staffId: 'staff-1', staffName: 'Unrelated Worker',
  workDate: '2026-07-31', kind: 'late_arrival', status: 'awaiting_supervisor', resultVersion: 4,
  permittedActions: ['approve'],
  queueOwnerUserId: null, createdAt: '2026-08-01T06:00:00Z', crewName: 'Crew A',
  site: { id: 'site-1', name: 'Midrand Core' },
  evidence: { entryId: 'entry-1', clockInAt: '2026-07-31T06:12:00Z', clockOutAt: '2026-07-31T15:00:00Z',
    clockInGpsAvailable: true, clockOutGpsAvailable: true, selfies: [] }, adjustment: null,
  proposedHours: { regular: 8, overtime: 0, sunday: 0, holiday: 0 },
  dailyResult: { status: 'awaiting_supervisor', scheduledPaidHours: 8, recordedElapsedHours: 8,
    proposedHours: { regular: 8, overtime: 0, sunday: 0, holiday: 0, leave: 0, unpaid: 0 },
    approvedHours: null, attendanceClassification: null, blockingReasons: ['late_arrival'] },
};
const queue = (items: DayExceptionItem[], status: DayExceptionListResult['status']): DayExceptionListResult => ({
  items, limit: status === 'all' ? 200 : 50, status, scope: { kind: 'scoped', staffCount: 1 },
});
const ok = (data: unknown): Response => (
  { ok: true, status: 200, json: async () => ({ success: true, data }) } as Response
);

beforeEach(() => vi.clearAllMocks());

it('fails a missing exact exception deep link closed without selecting an unrelated decision', async () => {
  global.fetch = vi.fn()
    .mockResolvedValueOnce(ok(queue([unrelated], 'unresolved')))
    .mockResolvedValueOnce(ok(queue([], 'all')));
  render(<StaffAttendanceActionsPage />);

  expect(await screen.findByRole('alert')).toHaveTextContent(/exact attendance action could not be confirmed/i);
  expect(screen.queryByTestId('action-detail')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /approve for payroll/i })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /refresh queue/i })).toBeVisible();
});
