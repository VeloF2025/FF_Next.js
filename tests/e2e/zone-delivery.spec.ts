import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installZoneDeliveryContract } from './zone-delivery-contract';
import {
  emptyRegisterResult,
  handedOverActivity,
  handedOverZone,
  PROJECT_ID,
  registerResult,
  SNAG_ID,
  ZONE_PATH,
  zoneQaZone,
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
    await expect(summary).toContainText('Zones1');
    await expect(summary).toContainText('Approved-scope PONs2');
    await expect(summary).toContainText('Technically live PONs1');
    await expect(summary).toContainText('Ready for Zone QA0');
    await expect(summary).toContainText('Handed over0');
    const registerRow = page.getByRole('row', { name: /Etwatwa Zone 12/ });
    await expect(registerRow.getByRole('cell')).toHaveText([
      'Etwatwa Zone 12',
      '1 / 2',
      'Port approved',
      '1',
      'Not started',
      'Not started',
      'Awaiting port approval',
    ]);

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
    const workspaceReads = {
      zone: [] as string[],
      activity: [] as string[],
    };
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname === '/api/zone-delivery/zone') {
        workspaceReads.zone.push(`${request.method()} ${url.pathname}${url.search}`);
      }
      if (url.pathname === '/api/zone-delivery/activity') {
        workspaceReads.activity.push(`${request.method()} ${url.pathname}${url.search}`);
      }
    });
    await page.goto('/field-ops');
    await page.getByRole('link', { name: 'Etwatwa Zone 12' }).click();
    await expect(page).toHaveURL(new RegExp(`${ZONE_PATH.replaceAll('?', '\\?')}$`));
    const expectedQuery = `project_id=${PROJECT_ID}&zone_no=12`;
    await expect.poll(() => [...new Set(workspaceReads.zone)])
      .toEqual([`GET /api/zone-delivery/zone?${expectedQuery}`]);
    await expect.poll(() => [...new Set(workspaceReads.activity)])
      .toEqual([`GET /api/zone-delivery/activity?${expectedQuery}`]);

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
    await expect(liveButton).toHaveAttribute('title', 'PON 9 port approval is required first');

    await expect(page.getByRole('link', { name: 'Active test pack for PON 9' })).toHaveAttribute('href', /test-pack-pon-9/);
    await expect(page.getByRole('link', { name: 'Active FAC' })).toHaveAttribute('href', /fac-zone-12/);
    await expect(page.getByRole('link', { name: 'Active CAC' })).toHaveAttribute('href', /cac-zone-12/);
    await expect(page.getByText(`SHA-256: ${'a'.repeat(64)}`)).toBeVisible();
    await expect(page.getByText(`SHA-256: ${'b'.repeat(64)}`)).toBeVisible();
    await expect(page.getByText(`SHA-256: ${'c'.repeat(64)}`)).toBeVisible();

    const snagLink = page.getByRole('link', { name: `Open snag ${SNAG_ID}` });
    await expect(snagLink).toHaveAttribute(
      'href',
      `/field-ops/snags?project_id=${PROJECT_ID}&zone_no=12&pon_no=9`,
    );
    const audit = page.getByRole('listitem', { name: 'port_approved_reopened' });
    await expect(audit.getByLabel('port_approved_reopened effective time')).toHaveAttribute('datetime', '2026-07-25T10:00:00.000Z');
    await expect(audit.getByLabel('port_approved_reopened recorded time')).toHaveAttribute('datetime', '2026-07-25T10:12:00.000Z');
    await expect(audit).toContainText('Previous:');
    await expect(audit).toContainText('"port_approved":');
    await expect(audit).toContainText('New: {}');
    await expect(audit).toContainText('Reason: Port label mismatch found during audit.');
    contract.setZone(zoneQaZone);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Civil Zone QA', exact: true })).toContainText('Passed');
    await expect(page.getByRole('region', { name: 'Optical Zone QA', exact: true })).toContainText('Failed');
    await attachScreenshot(page, testInfo, 'zone-workspace-desktop');
    expect(contract.unexpectedApiRequests).toEqual([]);
  });

  test('fails closed on malformed known read contracts', async ({ page }) => {
    const contract = await installZoneDeliveryContract(page);
    await page.goto('/field-ops');
    await expect(page.getByRole('link', { name: 'Etwatwa Zone 12' })).toBeVisible();

    const reads = [
      { method: 'POST', path: '/api/zone-delivery/register' },
      { method: 'GET', path: '/api/zone-delivery/register?unexpected=1' },
      { method: 'POST', path: `/api/zone-delivery/zone?project_id=${PROJECT_ID}&zone_no=12` },
      { method: 'GET', path: `/api/zone-delivery/zone?project_id=${PROJECT_ID}` },
      { method: 'GET', path: '/api/zone-delivery/zone?project_id=wrong&zone_no=12' },
      {
        method: 'POST',
        path: `/api/zone-delivery/activity?project_id=${PROJECT_ID}&zone_no=12`,
      },
      {
        method: 'GET',
        path: `/api/zone-delivery/activity?project_id=${PROJECT_ID}&zone_no=12&zone_no=12`,
      },
      {
        method: 'GET',
        path: `/api/zone-delivery/activity?project_id=${PROJECT_ID}&zone_no=12&unexpected=1`,
      },
    ];
    const statuses = await page.evaluate(async candidates => Promise.all(
      candidates.map(async candidate => {
        const response = await fetch(candidate.path, { method: candidate.method });
        return response.status;
      }),
    ), reads);

    expect(statuses).toEqual(reads.map(() => 418));
    const expectedUnexpected = reads.map(({ method, path }) => `${method} ${path}`).sort();
    expect(contract.unexpectedApiRequests).toHaveLength(expectedUnexpected.length);
    expect([...contract.unexpectedApiRequests].sort()).toEqual(expectedUnexpected);
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
    await expect(page.getByRole('listitem', { name: 'maintenance_linked' }))
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
