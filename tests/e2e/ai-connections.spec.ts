import { expect, test } from '@playwright/test';

const routes = [
  {
    path: '/connections/fibreflow',
    heading: 'FibreFlow Operations',
    endpoint: 'https://app.fibreflow.app/api/ff-remote-mcp/mcp',
  },
  {
    path: '/connections/cortex',
    heading: 'Cortex Knowledge',
    endpoint: 'https://app.fibreflow.app/api/cortex-remote-mcp/mcp',
  },
] as const;

for (const route of routes) {
  test(`${route.heading} desktop @connections`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: route.heading })).toBeVisible();
    await expect(page.getByText(route.endpoint)).toBeVisible();
    const nav = page.getByRole('navigation', {
      name: 'AI Connections navigation',
    });
    await expect(nav.getByRole('link', { name: 'FibreFlow' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Cortex' })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`${route.heading}-desktop.png`),
      fullPage: true,
    });
  });

  test(`${route.heading} mobile @connections @mobile`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: route.heading })).toBeVisible();
    expect(await page.evaluate(
      () => document.documentElement.scrollWidth
        <= document.documentElement.clientWidth,
    )).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`${route.heading}-mobile.png`),
      fullPage: true,
    });
  });
}

test('/cortex is knowledge-only @connections', async ({ page }) => {
  await page.goto('/cortex', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('main').getByRole(
    'link',
    { name: /AI Connections/i },
  )).toBeVisible();
  await expect(page.getByText(/Generate token/i)).toHaveCount(0);
  await expect(page.getByText('/path/to/Cortex')).toHaveCount(0);
});
