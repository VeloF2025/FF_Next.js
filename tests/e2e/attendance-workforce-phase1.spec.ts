import { readFile } from 'node:fs/promises';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  ATTENDANCE_IDS,
  FIXED_API_META,
  installAttendanceWorkforceFixture,
  WORKER,
} from './fixtures/attendance-workforce';

test.use({
  serviceWorkers: 'block',
  storageState: { cookies: [], origins: [] },
});

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function assertNoBodyOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test('renders fixed weekday, Saturday and Sunday schedules plus provisional caps', async ({ page }) => {
  const fixture = await installAttendanceWorkforceFixture(page);
  await page.goto('/my/attendance/clock?action=in');
  await expect(page.getByText('08:00–17:00', { exact: true })).toBeVisible();
  await expect(page.getByText('1h unpaid lunch', { exact: true })).toBeVisible();
  await expect(page.getByText('8h scheduled paid', { exact: true })).toBeVisible();

  fixture.setDay('saturday'); await page.reload();
  await expect(page.getByText('08:00–13:00', { exact: true })).toBeVisible();
  await expect(page.getByText('5h scheduled paid', { exact: true })).toBeVisible();
  fixture.setDay('sunday'); await page.reload();
  await expect(page.getByText('No scheduled shift', { exact: true })).toBeVisible();
  await expect(page.getByText('0h scheduled paid', { exact: true })).toBeVisible();
  await expect(page.getByText(/absence/i)).toHaveCount(0);

  fixture.seedMissingClockOut({ paidCapHours: 8 }); await page.reload();
  await expect(page.getByText('Provisional cap: 8 hours', { exact: true })).toBeVisible();
  fixture.seedMissingClockOut({ paidCapHours: 5 }); await page.reload();
  await expect(page.getByText('Provisional cap: 5 hours', { exact: true })).toBeVisible();
  expect(fixture.state.unexpected).toEqual([]);
});

test.describe('service-worker offline attendance', () => {
  test.use({ serviceWorkers: 'allow' });

  test('offline cold navigation and reload preserve unresolved eligibility, then fail closed', async ({
    page, context,
  }) => {
    const authCachedAt = Date.now();
    await page.clock.setFixedTime(new Date('2026-08-04T08:00:00+02:00'));
    const fixture = await installAttendanceWorkforceFixture(page);
    fixture.seedMissingClockOut({ paidCapHours: 8 });
    await page.goto('/my/attendance/clock?action=in');
    await expect(page.getByRole('heading', { name: /previous clock-out missing/i })).toBeVisible();

    await expect.poll(() => page.evaluate(async () => {
      const registration = (await navigator.serviceWorker.getRegistrations())
        .find((item) => new URL(item.scope).pathname === '/my/');
      return registration?.active?.scriptURL ?? '';
    }), { timeout: 30_000 }).toMatch(/\/sw-my\.js$/);
    const controllerUrl = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? '');
    if (!controllerUrl.endsWith('/sw-my.js')) {
      await page.reload();
      await expect(page.getByRole('heading', { name: /previous clock-out missing/i })).toBeVisible();
    }
    await expect.poll(() => page.evaluate(
      () => navigator.serviceWorker.controller?.scriptURL ?? ''
    ), { timeout: 30_000 }).toMatch(/\/sw-my\.js$/);

    const sessionResponse = fixture.request('GET', '/api/my/session')?.response;
    const authResponse = fixture.request('GET', '/api/auth/me')?.response;
    expect(sessionResponse).toBeDefined();
    expect(authResponse).toBeDefined();
    await page.evaluate(async ({ authCachedAtValue, authPayload, sessionPayload }) => {
      const shell = await caches.open('my-portal-v5');
      const assetUrls = [
        location.href,
        ...Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'), (node) => node.src),
        ...Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'),
          (node) => node.href),
      ];
      await shell.addAll([...new Set(assetUrls)]);
      const sessionCache = await caches.open('my-offline-v1');
      const headers = {
        'Content-Type': 'application/json',
        'x-ff-cached-at': String(authCachedAtValue),
      };
      await Promise.all([
        sessionCache.put('/api/my/session', new Response(JSON.stringify(sessionPayload), {
          status: 200, headers,
        })),
        sessionCache.put('/api/auth/me', new Response(JSON.stringify(authPayload), {
          status: 200, headers,
        })),
      ]);
    }, { authCachedAtValue: authCachedAt, authPayload: authResponse, sessionPayload: sessionResponse });

    await context.setOffline(true);
    const popupPromise = context.waitForEvent('page');
    await page.evaluate(() => window.open('about:blank', '_blank'));
    const offlinePage = await popupPromise;
    await offlinePage.clock.setFixedTime(new Date('2026-08-04T08:00:00+02:00'));
    await offlinePage.goto('/my/attendance/clock?action=in');
    await expect(offlinePage.getByRole('heading', { name: /previous clock-out missing/i })).toBeVisible();
    await offlinePage.reload();
    await expect(offlinePage.getByRole('heading', { name: /previous clock-out missing/i })).toBeVisible();
    await expect(offlinePage.getByRole('button', { name: /take clock-in selfie/i })).toHaveCount(0);

    const eligibilityKey = `ff:attendance-eligibility:v1:${encodeURIComponent(WORKER.staffId)}`;
    expect(await offlinePage.evaluate((key) => localStorage.getItem(key), eligibilityKey)).not.toBeNull();
    await offlinePage.evaluate(() => localStorage.clear());
    expect(await offlinePage.evaluate((key) => localStorage.getItem(key), eligibilityKey)).toBeNull();
    await offlinePage.reload();
    await expect(offlinePage.getByRole('alert', { name: /schedule unavailable/i })).toBeVisible();
    await expect(offlinePage.getByRole('button', { name: /take clock-in selfie/i })).toHaveCount(0);

    const cachedIdentityCount = () => page.evaluate(async () => {
      const cache = await caches.open('my-offline-v1');
      const matches = await Promise.all([
        cache.match('/api/my/session'), cache.match('/api/auth/me'),
      ]);
      return matches.filter(Boolean).length;
    });
    await expect.poll(cachedIdentityCount).toBe(2);
    await offlinePage.getByRole('button', { name: 'Sign out' }).click();
    await expect.poll(cachedIdentityCount).toBe(0);

    const signedOutPopup = context.waitForEvent('page');
    await page.evaluate(() => window.open('about:blank', '_blank'));
    const signedOutPage = await signedOutPopup;
    await signedOutPage.clock.setFixedTime(new Date('2026-08-04T08:00:00+02:00'));
    await signedOutPage.goto('/my/attendance/clock?action=in');
    await expect(signedOutPage.getByText(/could not verify your session/i)).toBeVisible();
    await expect(signedOutPage.getByText(WORKER.name, { exact: true })).toHaveCount(0);
    await signedOutPage.reload();
    await expect(signedOutPage.getByText(/could not verify your session/i)).toBeVisible();
    expect(fixture.state.unexpected).toEqual([]);
  });
});

test('missing clock-out correction unlocks work before supervisor approval', async ({ page }, testInfo) => {
  const fixture = await installAttendanceWorkforceFixture(page);
  fixture.seedMissingClockOut({ paidCapHours: 8 });

  await page.goto('/my/attendance/clock?action=in');
  await expect(page.getByRole('heading', { name: /previous clock-out missing/i })).toBeVisible();
  await page.getByRole('button', { name: /submit clock-out correction/i }).click();
  await page.getByLabel(/correct clock-out/i).fill('2026-08-03T17:00');
  await page.getByLabel(/why/i).fill('Forgot during site close and vehicle handover');
  await expect(page.getByText(/today's clock-in is now enabled/i)).toHaveCount(0);
  await page.getByRole('button', { name: /submit clock-out correction/i }).click();
  await expect(page.getByText(/today's clock-in is now enabled/i)).toBeVisible();

  expect(fixture.readAttendanceState(WORKER.staffId, '2026-08-03')).toMatchObject({
    resultStatus: 'awaiting_supervisor',
    adjustmentStatus: 'pending',
    proposedRegularHours: 8,
  });
  expect(fixture.request('POST', '/api/my/attendance-corrections')).toEqual({
    method: 'POST', path: '/api/my/attendance-corrections', status: 200,
    body: { entry_id: ATTENDANCE_IDS.entry, exception_id: ATTENDANCE_IDS.exception,
      adjustment_kind: 'forgot_clock_out', adjusted_clock_in_at: null,
      adjusted_clock_out_at: '2026-08-03T15:00:00.000Z', adjusted_site_geofence_id: null,
      reason: 'Forgot during site close and vehicle handover' },
    response: { success: true, data: { adjustmentId: ATTENDANCE_IDS.adjustment,
      exceptionId: ATTENDANCE_IDS.exception, decisionEventId: ATTENDANCE_IDS.decision,
      exceptionStatus: 'awaiting_supervisor' }, meta: FIXED_API_META },
  });
  expect(fixture.state.mutations.filter((item) => item.path === '/api/my/attendance-corrections')).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoBodyOverflow(page);
  const clockIn = page.getByRole('link', { name: 'Clock in', exact: true });
  await expect.poll(() => clockIn.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await capture(page, testInfo, 'attendance-correction-mobile-confirmed');
  expect(fixture.state.unexpected).toEqual([]);
});

test('supervisor returns an exact action and exposes unavailable, empty, error and stale states', async ({ page }, testInfo) => {
  const fixture = await installAttendanceWorkforceFixture(page);
  fixture.seedActions(['missing_clock_out']);
  await page.goto('/staff/attendance/corrections');
  await expect(page.getByRole('heading', { name: 'Attendance Actions' })).toBeVisible();
  await expect(page.getByText('Unavailable', { exact: true })).toHaveCount(5);
  await expect(page.getByText(/verified/i)).toHaveCount(0);
  await page.getByLabel('Decision reason').fill('Worker must clarify the recorded close time');
  await page.getByRole('button', { name: 'Return to worker', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/confirmed from the refreshed queue/i);
  expect(fixture.state.queue[0].status).toBe('awaiting_worker');

  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, testInfo, 'attendance-actions-desktop-evidence-unavailable');

  fixture.seedActions([]); await page.reload();
  await expect(page.getByText(/no attendance actions match/i)).toBeVisible();
  await capture(page, testInfo, 'attendance-actions-desktop-empty');
  fixture.setQueueFailure('Controlled queue unavailable'); await page.reload();
  await expect(page.getByTestId('attendance-actions-page').getByRole('alert')).toContainText('Controlled queue unavailable');
  await expect(page.getByText(/no attendance actions match/i)).toHaveCount(0);
  await capture(page, testInfo, 'attendance-actions-desktop-error');
  fixture.setQueueFailure(null); fixture.seedActions(['outside_schedule']); fixture.makeNextReviewStale();
  await page.reload();
  await page.getByLabel('Decision reason').fill('Reviewed before stale server response');
  await page.getByRole('button', { name: 'Approve for payroll', exact: true }).click();
  const staleAlert = page.getByTestId('attendance-actions-page').getByRole('alert');
  await expect(staleAlert).toContainText(/changed since you opened it/i);
  await staleAlert.scrollIntoViewIfNeeded();
  await capture(page, testInfo, 'attendance-actions-desktop-stale');
  expect(fixture.state.unexpected).toEqual([]);
});

test('supervisor approves Sunday and outside-schedule work with exact readback', async ({ page }) => {
  const fixture = await installAttendanceWorkforceFixture(page);
  for (const kind of ['sunday_work', 'outside_schedule']) {
    fixture.seedActions([kind]); await page.goto('/staff/attendance/corrections');
    await page.getByLabel('Decision reason').fill(`Approved ${kind} after supervisor evidence review`);
    await page.getByRole('button', { name: 'Approve for payroll', exact: true }).click();
    await expect(page.getByRole('status')).toContainText(/confirmed from the refreshed queue/i);
    expect(fixture.state.queue[0]).toMatchObject({ status: 'resolved', dailyResult: { status: 'approved' } });
  }
  expect(fixture.state.mutations.filter((item) => item.path.endsWith('exceptions-review'))).toHaveLength(2);
});

test('HR blocker fails closed, then lock and unlock require confirmed readback', async ({ page }, testInfo) => {
  const fixture = await installAttendanceWorkforceFixture(page);
  await page.goto('/staff/attendance/locks?week=2026-08-03');
  await expect(page.getByText('Not ready to lock', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /supervisor action/i })).toHaveAttribute('href', new RegExp(ATTENDANCE_IDS.exception));
  await expect(page.getByRole('button', { name: /lock week/i })).toBeDisabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, testInfo, 'attendance-readiness-desktop-blocked');

  fixture.setReady(true);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('Ready to lock', { exact: true })).toBeVisible();
  await page.getByLabel('Lock reason', { exact: true }).fill('Approved parallel payroll close');
  await page.getByRole('button', { name: /lock week/i }).click();
  await expect(page.getByRole('status')).toContainText(/lock saved and confirmed/i);
  await page.getByRole('button', { name: 'Unlock week', exact: true }).click();
  await page.getByLabel(/unlock reason/i).fill('Correction requested after payroll review');
  await page.getByRole('button', { name: 'Confirm unlock', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/unlock saved and confirmed/i);
  expect(fixture.state.lock).toMatchObject({ latest_action: 'unlock', unlocked_by: ATTENDANCE_IDS.admin });
  expect(fixture.state.unexpected).toEqual([]);
});

test('locked export is deterministic across repeated downloads', async ({ page }) => {
  const fixture = await installAttendanceWorkforceFixture(page);
  fixture.setReady(true);
  fixture.state.lock = { week_start_date: '2026-08-03', locked_at: '2026-08-10T07:00:00.000Z',
    locked_by: ATTENDANCE_IDS.admin, lock_reason: 'Approved payroll close', unlocked_at: null, unlocked_by: null,
    unlock_reason: null, lock_version: 1, latest_action: 'lock', latest_actor_user_id: ATTENDANCE_IDS.admin,
    latest_reason: 'Approved payroll close', latest_recorded_at: '2026-08-10T07:00:00.000Z' };
  await page.goto('/staff/attendance/week');
  await page.getByLabel('Week-start (auto-snaps to Monday)', { exact: true }).fill('2026-08-03');
  await expect(page.getByText(/locked at version 1/i)).toBeVisible();
  const downloads: Buffer[] = [];
  for (let count = 0; count < 2; count += 1) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'CSV', exact: true }).click();
    downloads.push(await readFile(await (await download).path() as string));
  }
  expect(downloads[0].equals(downloads[1])).toBe(true);

  expect(fixture.state.unexpected).toEqual([]);
});

test('Task 13 cards and successful report export share screen columns', async ({ page }, testInfo) => {
  const fixture = await installAttendanceWorkforceFixture(page);
  await page.goto('/staff/attendance/reports');
  for (const title of ['Exception ageing', 'Payroll readiness', 'Evidence quality']) {
    await expect(page.getByRole('link', { name: new RegExp(title, 'i') })).toBeVisible();
  }
  await page.getByRole('link', { name: /payroll readiness/i }).click();
  await expect(page.getByRole('heading', { name: 'Payroll readiness', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader')).toHaveText(['Staff', 'Blocked days', 'Approved regular']);
  await expect(page.getByRole('row', { name: /Jane Worker/ })).toContainText('48');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV', exact: true }).click();
  expect((await readFile(await (await download).path() as string)).toString()).toBe(
    'staff_name,blocked_days,approved_regular_hours\nJane Worker,0,48\n');
  await capture(page, testInfo, 'attendance-report-desktop-parity');
  expect(fixture.state.unexpected).toEqual([]);
});
