import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installZoneDeliveryContract } from './zone-delivery-contract';
import {
  emptyRegisterResult,
  handedOverActivity,
  handedOverZone,
  PROJECT_ID,
  registerResult,
  ZONE_PATH,
} from './zone-delivery-fixtures';

test.use({
  serviceWorkers: 'block',
  storageState: { cookies: [], origins: [] },
});

const moduleTabLabels = async (page: Page) =>
  page.getByRole('navigation', { name: 'Module tabs' })
    .locator('a, button')
    .allInnerTexts()
    .then(labels => labels.map(label => label.trim()));

const attachScreenshot = async (page: Page, testInfo: TestInfo, name: string) => {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
};

test.describe('Zone Delivery user journey @contract', () => {
  test('shows the ordered navigation, exact register summary, filters, and stable row link', async ({ page }, testInfo) => {
    const contract = await installZoneDeliveryContract(page);
    await page.goto('/field-ops');

    await expect.poll(() => moduleTabLabels(page)).toEqual([
      'QA Centre',
      'Works QA',
      'OTDR Testing',
      'Snags',
      'Reports',
    ]);
    const summary = page.locator('dl');
    await expect(summary).toContainText('Zones4');
    await expect(summary).toContainText('Approved-scope PONs14');
    await expect(summary).toContainText('Technically live PONs11');
    await expect(summary).toContainText('Ready for Zone QA2');
    await expect(summary).toContainText('Handed over1');
    await expect(page.getByRole('row', { name: /Etwatwa Zone 12/ })).toContainText('8 / 9');

    const waitForQuery = (key: string, value: string) => page.waitForRequest(request => {
      const url = new URL(request.url());
      return url.pathname === '/api/zone-delivery/register' && url.searchParams.get(key) === value;
    });
    await Promise.all([
      waitForQuery('project_id', PROJECT_ID),
      page.getByLabel('Project', { exact: true }).selectOption(PROJECT_ID),
    ]);
    await Promise.all([
      waitForQuery('zone_no', '12'),
      page.getByLabel('Zone number').fill('12'),
    ]);
    await Promise.all([
      waitForQuery('status', 'handover_blocked'),
      page.getByLabel('Status', { exact: true }).selectOption('handover_blocked'),
    ]);
    await Promise.all([
      waitForQuery('blocker', 'snag'),
      page.getByLabel('Blocker').fill('snag'),
    ]);
    await Promise.all([
      waitForQuery('handover', 'pending'),
      page.getByLabel('Handover').selectOption('pending'),
    ]);
    await Promise.all([
      waitForQuery('search', 'Etwatwa'),
      page.getByRole('textbox', { name: 'Search', exact: true }).fill('Etwatwa'),
    ]);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect.poll(() => contract.registerRequests.at(-1)?.search).toBe('');
    await expect(page.getByRole('link', { name: 'Etwatwa Zone 12' })).toHaveAttribute('href', ZONE_PATH);
    await attachScreenshot(page, testInfo, 'zone-register-desktop');
    expect(contract.unexpectedApiRequests).toEqual([]);
  });

  test('keeps rows during refresh and recovers from empty and non-2xx states with Retry', async ({ page }) => {
    const contract = await installZoneDeliveryContract(page);
    contract.pauseNextRegister();
    await page.goto('/field-ops', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Loading zone delivery register').first()).toBeVisible();
    contract.releaseRegister();
    await expect(page.getByRole('link', { name: 'Etwatwa Zone 12' })).toBeVisible();

    contract.pauseNextRegister();
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.getByRole('button', { name: 'Refreshing' })).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Etwatwa Zone 12' })).toBeVisible();
    contract.releaseRegister();
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled();

    contract.setRegister(emptyRegisterResult);
    await page.getByRole('textbox', { name: 'Search', exact: true }).fill('nothing');
    await expect(page.getByText('No zones match the current filters.')).toBeVisible();

    contract.setRegisterFailure('Register service unavailable.');
    await page.getByLabel('Blocker').fill('force-error');
    await expect(page.getByRole('alert').filter({ hasText: 'Register service unavailable.' })).toBeVisible();
    contract.setRegister(registerResult);
    contract.setRegisterFailure(null);
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('link', { name: 'Etwatwa Zone 12' })).toBeVisible();
    expect(contract.unexpectedApiRequests).toEqual([]);
  });

  test('navigates to authoritative PON gates, QA, evidence, snags, and audit history', async ({ page }, testInfo) => {
    const contract = await installZoneDeliveryContract(page);
    await page.goto('/field-ops');
    await page.getByRole('link', { name: 'Etwatwa Zone 12' }).click();
    await expect(page).toHaveURL(new RegExp(`${ZONE_PATH.replaceAll('?', '\\?')}$`));

    await expect(page.getByTestId('lifecycle-gate')).toHaveText([
      'Civil complete',
      'Optical complete',
      'Testing passed',
      'Port submitted',
      'Port approved',
      'Technically live',
    ]);
    const liveButton = page.getByRole('button', { name: 'Confirm Technically live for PON 9' });
    await expect(liveButton).toBeDisabled();
    await expect(liveButton).toHaveAttribute('title', 'PON 9 is waiting for supervised port approval.');
    await expect(page.getByRole('region', { name: 'Civil Zone QA', exact: true })).toContainText('Passed');
    await expect(page.getByRole('region', { name: 'Optical Zone QA', exact: true })).toContainText('Failed');

    await expect(page.getByRole('link', { name: 'Active test pack for PON 9' })).toHaveAttribute('href', /test-pack-pon-9/);
    await expect(page.getByRole('link', { name: 'Active FAC' })).toHaveAttribute('href', /fac-zone-12/);
    await expect(page.getByRole('link', { name: 'Active CAC' })).toHaveAttribute('href', /cac-zone-12/);
    await expect(page.getByText('SHA-256: test-pack-checksum-009')).toBeVisible();
    await expect(page.getByText('SHA-256: fac-checksum-zone-12')).toBeVisible();
    await expect(page.getByText('SHA-256: cac-checksum-zone-12')).toBeVisible();

    const snagLink = page.getByRole('link', { name: 'Open in Snags' });
    await expect(snagLink).toHaveAttribute(
      'href',
      `/field-ops/snags?project_id=${PROJECT_ID}&zone_no=12&pon_no=9`,
    );
    const audit = page.getByRole('listitem', { name: 'milestone_reopened' });
    await expect(audit.getByLabel('milestone_reopened effective time')).toHaveAttribute('datetime', '2026-07-25T10:00:00.000Z');
    await expect(audit.getByLabel('milestone_reopened recorded time')).toHaveAttribute('datetime', '2026-07-25T10:12:00.000Z');
    await expect(audit).toContainText('Previous:');
    await expect(audit).toContainText('"portApproved": true');
    await expect(audit).toContainText('"portApproved": false');
    await expect(audit).toContainText('Reason: Port label mismatch found during audit.');
    await attachScreenshot(page, testInfo, 'zone-workspace-desktop');
    expect(contract.unexpectedApiRequests).toEqual([]);
  });

  test('renders automatic handover as terminal while preserving post-handover maintenance', async ({ page }) => {
    const contract = await installZoneDeliveryContract(page);
    contract.setZone(handedOverZone, handedOverActivity);
    await page.goto(ZONE_PATH);

    await expect(page.getByText('Handed over', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Handover time')).toHaveAttribute('datetime', '2026-07-28T10:15:00.000Z');
    await expect(page.getByRole('button', { name: /^Confirm / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Record .* Zone QA/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Upload evidence' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Link maintenance issue for PON 8' })).toBeVisible();
    await expect(page.getByRole('listitem', { name: 'post_handover_maintenance_linked' }))
      .toContainText('Non-blocking maintenance observation.');
    expect(contract.unexpectedApiRequests).toEqual([]);
  });

  test('contains wide tables without body-level mobile overflow', async ({ page }, testInfo) => {
    const contract = await installZoneDeliveryContract(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/field-ops');

    const registerScroller = page.getByRole('table').locator('..');
    await expect.poll(() => registerScroller.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);

    await page.goto(ZONE_PATH);
    const ponScroller = page.getByRole('table').locator('..');
    await expect.poll(() => ponScroller.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
    await attachScreenshot(page, testInfo, 'zone-workspace-mobile');
    expect(contract.unexpectedApiRequests).toEqual([]);
  });
});
