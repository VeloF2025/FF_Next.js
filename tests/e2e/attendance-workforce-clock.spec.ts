import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { resolve } from 'node:path';

import {
  ATTENDANCE_IDS,
  FIXED_API_META,
  installAttendanceWorkforceFixture,
} from './fixtures/attendance-workforce';

const CLOCK_TIME = '2026-08-04T06:00:00.000Z';
const CLOCK_OUT_TIME = '2026-08-04T15:00:00.000Z';
const DEVICE_FINGERPRINT = '0123456789abcdef0123456789abcdef';
const SELFIE = resolve('public/icon.png');

test.use({ serviceWorkers: 'block', storageState: { cookies: [], origins: [] } });

async function prepareClock(page: Page) {
  await page.clock.setFixedTime(new Date(CLOCK_TIME));
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: -26.2041, longitude: 28.0473, accuracy: 25 });
  await page.addInitScript((fingerprint) => {
    window.localStorage.setItem('ff.my.device_fingerprint.v1', fingerprint);
  }, DEVICE_FINGERPRINT);
}

async function addEvidence(page: Page) {
  await page.locator('input[type="file"]').setInputFiles(SELFIE);
  await expect(page.getByText('-26.20410, 28.04730', { exact: true })).toBeVisible();
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function clockStore(page: Page, name: 'pendingClockEvents' | 'droppedClockEvents') {
  return page.evaluate((storeName) => new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const request = indexedDB.open('AttendanceOfflineDB', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      get.onerror = () => reject(get.error);
      get.onsuccess = () => { db.close(); resolve(get.result); };
    };
  }), name);
}

async function setOnline(page: Page, online: boolean) {
  await page.evaluate((value) => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value });
    window.dispatchEvent(new Event(value ? 'online' : 'offline'));
  }, online);
}

test('normal weekday clock-in and clock-out confirm exact requests, responses and one closed server entry', async ({ page }, testInfo) => {
  const fixture = await installAttendanceWorkforceFixture(page);
  await prepareClock(page);

  await page.goto('/my/attendance/clock?action=in');
  await addEvidence(page);
  await page.getByRole('button', { name: 'Submit clock in', exact: true }).click();
  await expect(page.getByText('Clocked in at Midrand Core.', { exact: true })).toBeVisible();
  expect(fixture.request('POST', '/api/my/attendance/clock-in')).toEqual({
    method: 'POST', path: '/api/my/attendance/clock-in', status: 200,
    body: {
      lat: -26.2041, lon: 28.0473, accuracy_m: 25, client_occurred_at: CLOCK_TIME,
      selfie_base64: expect.stringMatching(/^[A-Za-z0-9+/=]{100,}$/),
      device_fingerprint: DEVICE_FINGERPRINT,
    },
    response: { success: true, data: {
      entryId: ATTENDANCE_IDS.entry, workDate: '2026-08-04', clockInAt: CLOCK_TIME,
      siteId: ATTENDANCE_IDS.site, siteName: 'Midrand Core', insideSite: true,
      vehicleAssignmentId: null, selfieUrl: '/storage/attendance/controlled-in.jpg',
    }, meta: FIXED_API_META },
  });
  expect(fixture.readServerEntry()).toMatchObject({ id: ATTENDANCE_IDS.entry, status: 'open', clockOutAt: null });

  await page.clock.setFixedTime(new Date(CLOCK_OUT_TIME));
  await page.goto('/my/attendance/clock?action=out');
  await addEvidence(page);
  await page.getByRole('button', { name: 'Submit clock out', exact: true }).click();
  await expect(page.getByText('Clocked out. Shift length: 9.0h.', { exact: true })).toBeVisible();
  expect(fixture.request('POST', '/api/my/attendance/clock-out')).toEqual({
    method: 'POST', path: '/api/my/attendance/clock-out', status: 200,
    body: {
      lat: -26.2041, lon: 28.0473, accuracy_m: 25, client_occurred_at: CLOCK_OUT_TIME,
      selfie_base64: expect.stringMatching(/^[A-Za-z0-9+/=]{100,}$/),
      device_fingerprint: DEVICE_FINGERPRINT,
    },
    response: { success: true, data: {
      entryId: ATTENDANCE_IDS.entry, clockInAt: CLOCK_TIME,
      clockOutAt: CLOCK_OUT_TIME, workDate: '2026-08-04', durationMs: 32_400_000,
      selfieUrl: '/storage/attendance/controlled-out.jpg',
    }, meta: FIXED_API_META },
  });
  expect(fixture.readServerEntry()).toEqual({
    id: ATTENDANCE_IDS.entry, status: 'closed', clockInAt: CLOCK_TIME,
    clockOutAt: CLOCK_OUT_TIME,
  });
  expect(fixture.readCompletedDay()).toEqual({ staffId: ATTENDANCE_IDS.worker,
    workDate: '2026-08-04', resultStatus: 'complete', recordedElapsedHours: 9,
    proposedRegularHours: 8 });
  expect(fixture.state.mutations.filter((item) => item.path.includes('/api/my/attendance/clock-'))).toHaveLength(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, testInfo, 'attendance-weekday-clockout-mobile-confirmed');
  expect(fixture.state.unexpected).toEqual([]);
});

test('offline PendingClockEvent drains on the real 409 open_entry contract without duplicating server state', async ({ page }, testInfo) => {
  const fixture = await installAttendanceWorkforceFixture(page);
  await prepareClock(page);
  await page.goto('/my/attendance/clock?action=in');
  await addEvidence(page);
  await setOnline(page, false);
  await expect(page.getByText(/you are offline/i)).toBeVisible();
  await page.getByRole('button', { name: 'Submit clock in', exact: true }).click();
  await expect(page.getByText('Clock-in saved on this phone.', { exact: true })).toBeVisible();

  const pending = await clockStore(page, 'pendingClockEvents');
  expect(pending).toHaveLength(1);
  expect(pending[0]).toEqual({
    id: expect.stringMatching(/^[0-9a-f-]{36}$/i), action: 'in', lat: -26.2041, lon: 28.0473,
    accuracyM: 25, clientOccurredAt: CLOCK_TIME,
    selfieBase64: expect.stringMatching(/^[A-Za-z0-9+/=]{100,}$/),
    deviceFingerprint: DEVICE_FINGERPRINT, queuedAt: CLOCK_TIME, attempts: 0,
  });

  fixture.seedServerOpenEntry();
  await setOnline(page, true);
  await expect.poll(async () => (await clockStore(page, 'pendingClockEvents')).length).toBe(0);
  const dropped = await clockStore(page, 'droppedClockEvents');
  expect(dropped).toHaveLength(1);
  expect(dropped[0]).toMatchObject({
    id: pending[0].id, action: 'in', dropReason: 'Dropped queued clock-in: you already had an open shift.',
  });
  await expect(page.getByRole('heading', { name: 'Queued event not submitted', exact: true })).toBeVisible();
  await expect(page.getByText('Dropped queued clock-in: you already had an open shift.', { exact: true })).toBeVisible();
  await expect(page.getByText('Saved on this phone — not yet submitted', { exact: true })).toHaveCount(0);
  expect(fixture.request('POST', '/api/my/attendance/clock-in')).toEqual({
    method: 'POST', path: '/api/my/attendance/clock-in', status: 409,
    body: {
      lat: -26.2041, lon: 28.0473, accuracy_m: 25, client_occurred_at: CLOCK_TIME,
      selfie_base64: pending[0].selfieBase64, device_fingerprint: DEVICE_FINGERPRINT,
    },
    response: { success: false, error: {
      code: 'CONFLICT', message: 'You already have an open attendance entry. Close it before clocking in again.',
      details: { reason: 'open_entry', openEntryId: ATTENDANCE_IDS.entry, openedAt: CLOCK_TIME },
    }, meta: FIXED_API_META },
  });
  expect(fixture.readServerEntry()).toMatchObject({ id: ATTENDANCE_IDS.entry, status: 'open' });
  expect(fixture.state.mutations.filter((item) => item.path === '/api/my/attendance/clock-in')).toHaveLength(0);
  await capture(page, testInfo, 'attendance-offline-open-entry-conflict');
  expect(fixture.state.unexpected).toEqual([]);
});
