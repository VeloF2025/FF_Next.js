import { expect, test, type Page, type TestInfo } from '@playwright/test';

import {
  ATTENDANCE_IDS,
  FIXED_API_META,
  WORKER,
  installAttendanceWorkforceFixture,
} from './fixtures/attendance-workforce';

test.use({ serviceWorkers: 'block', storageState: { cookies: [], origins: [] } });

const HOURS = { regular: 8, overtime: 0, sunday: 0, holiday: 0, leave: 0, unpaid: 0 };
const CLASSIFICATIONS = [
  ['approved_leave', 'Approved leave'],
  ['sick_leave', 'Sick leave'],
  ['site_shutdown_weather', 'Site shutdown / weather'],
  ['public_holiday', 'Public holiday'],
  ['unauthorised_absence', 'Unauthorised absence'],
] as const;

function classificationHours(classification: typeof CLASSIFICATIONS[number][0]) {
  const leave = classification === 'approved_leave' || classification === 'sick_leave';
  const closure = classification === 'site_shutdown_weather';
  return { regular: closure ? 8 : 0, overtime: 0, sunday: 0,
    holiday: classification === 'public_holiday' ? 8 : 0,
    leave: leave ? 8 : 0, unpaid: classification === 'unauthorised_absence' ? 8 : 0 };
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('all five absence classifications persist exact requests, responses and refreshed readback', async ({ page }) => {
  const fixture = await installAttendanceWorkforceFixture(page);
  await page.goto('/staff/attendance/corrections');

  for (const [index, [classification, label]] of CLASSIFICATIONS.entries()) {
    fixture.seedActions(['missing_clock_in']);
    await page.reload();
    await page.getByLabel('Absence classification').selectOption({ label });
    const reason = `Classification ${index + 1} supported by reviewed evidence`;
    await page.getByLabel('Decision reason').fill(reason);
    await page.getByRole('button', { name: 'Classify absence', exact: true }).click();
    await expect(page.getByRole('status')).toContainText(/confirmed from the refreshed queue/i);
    const approvedHours = classificationHours(classification);

    expect(fixture.request('POST', '/api/staff/attendance-day-exceptions-review')).toEqual({
      method: 'POST', path: '/api/staff/attendance-day-exceptions-review', status: 200,
      body: {
        exception_id: ATTENDANCE_IDS.exception, expected_result_version: 4,
        action: 'classify', reason, classification,
      },
      response: { success: true, data: {
        exception: { id: ATTENDANCE_IDS.exception, status: 'resolved', resultVersion: 5,
          classification, resolutionReason: reason },
        dailyResult: { staffId: WORKER.staffId, workDate: '2026-08-03', status: 'approved',
          resultVersion: 5, approvedHours, attendanceClassification: classification },
        decisionEventId: ATTENDANCE_IDS.decision,
      }, meta: FIXED_API_META },
    });
    expect(fixture.readAction(ATTENDANCE_IDS.exception)).toMatchObject({
      status: 'resolved', resultVersion: 5,
      dailyResult: { status: 'approved', attendanceClassification: classification, approvedHours },
    });
    expect(fixture.state.mutations.filter((item) => item.path.endsWith('exceptions-review'))).toHaveLength(index + 1);
  }
  expect(fixture.state.unexpected).toEqual([]);
});

test('supervisor approves the missing-clock correction and unreliable evidence stays distinct from unavailable', async ({ page }, testInfo) => {
  const fixture = await installAttendanceWorkforceFixture(page);
  fixture.seedActions(['missing_clock_out']);
  await page.goto('/staff/attendance/corrections');
  const reason = 'Approved corrected clock-out after reviewing worker statement';
  await page.getByLabel('Decision reason').fill(reason);
  await page.getByRole('button', { name: 'Approve for payroll', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/confirmed from the refreshed queue/i);
  expect(fixture.request('POST', '/api/staff/attendance-day-exceptions-review')).toEqual({
    method: 'POST', path: '/api/staff/attendance-day-exceptions-review', status: 200,
    body: {
      exception_id: ATTENDANCE_IDS.exception, expected_result_version: 4,
      action: 'approve', reason, approved_hours: HOURS,
    },
    response: { success: true, data: {
      exception: { id: ATTENDANCE_IDS.exception, status: 'resolved', resultVersion: 5,
        classification: null, resolutionReason: reason },
      dailyResult: { staffId: WORKER.staffId, workDate: '2026-08-03', status: 'approved',
        resultVersion: 5, approvedHours: HOURS, attendanceClassification: null },
      decisionEventId: ATTENDANCE_IDS.decision,
    }, meta: FIXED_API_META },
  });
  expect(fixture.readAction(ATTENDANCE_IDS.exception)).toMatchObject({
    status: 'resolved', adjustment: { status: 'approved' },
    dailyResult: { status: 'approved', approvedHours: HOURS },
  });

  fixture.seedActions(['evidence_unreliable']);
  await page.reload();
  const blocker = page.getByText('Payroll blockers', { exact: true }).locator('..');
  await expect(blocker.getByText('Evidence unreliable', { exact: true })).toBeVisible();
  await expect(page.locator('[data-evidence-status="available"]')).toHaveCount(6);
  await expect(page.getByText('Unavailable', { exact: true })).toHaveCount(0);
  await capture(page, testInfo, 'attendance-actions-desktop-evidence-unreliable');
  expect(fixture.state.unexpected).toEqual([]);
});

test('limited supervisor gets the real weekly-lock POST 403 with zero mutation or lock drift', async ({ page }) => {
  const fixture = await installAttendanceWorkforceFixture(page);
  fixture.setActorRole('site_supervisor');
  await page.goto('/staff/attendance/locks?week=2026-08-03');
  const before = fixture.state.lock;
  const denied = await page.evaluate(async () => {
    const response = await fetch('/api/staff/attendance-weekly-locks', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week_start_date: '2026-08-03', action: 'lock', lock_reason: 'Attempt outside HR authority' }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(denied).toEqual({ status: 403, body: { success: false, error: {
    code: 'FORBIDDEN', message: 'Attendance lock authority is restricted to HR administrators',
  }, meta: FIXED_API_META } });
  expect(fixture.request('POST', '/api/staff/attendance-weekly-locks')).toEqual({
    method: 'POST', path: '/api/staff/attendance-weekly-locks', status: 403,
    body: { week_start_date: '2026-08-03', action: 'lock', lock_reason: 'Attempt outside HR authority' },
    response: denied.body,
  });
  expect(fixture.state.mutations.filter((item) => item.path === '/api/staff/attendance-weekly-locks')).toHaveLength(0);
  expect(fixture.state.lock).toEqual(before);
  expect(fixture.state.unexpected).toEqual([]);
});
