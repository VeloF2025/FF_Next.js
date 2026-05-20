import { test, expect } from '@playwright/test';

/**
 * P3 — End-to-end smoke test for the scoped snag report flow.
 *
 * Walks the full user journey:
 *   1. Navigate to Works QA with a project + zone context (Lawley, zone 24)
 *   2. Verify the context-aware "Zone report" button is rendered
 *   3. Open the dialog, submit the default scope
 *   4. Verify confirmation panel shows `SCOPE-…` report_number and PDF link
 *   5. Verify the PDF URL is reachable (HEAD 200)
 *   6. Open the library page, switch to the "Scoped" filter chip
 *   7. Verify the newly generated report appears in the list
 *
 * Runs against whichever env Playwright's baseURL points at (E2E_BASE_URL or
 * playwright.config defaults). Assumes Lawley has at least one snag in zone 24.
 */

const LAWLEY_PROJECT_ID = process.env.E2E_LAWLEY_PROJECT_ID;

test('P3: generate Zone 24 snag report from WorksQAPage and find it in the library', async ({ page, request }) => {
  test.skip(
    !LAWLEY_PROJECT_ID,
    'E2E_LAWLEY_PROJECT_ID not set — see .env.local.example for the Lawley UUID on this environment',
  );
  // test.skip aborts the test but TS doesn't narrow string|undefined across it.
  const projectId = LAWLEY_PROJECT_ID as string;

  // 1. Land on WorksQAPage with zone_no=24 in the URL → button should label "Zone report"
  await page.goto(`/works-qa?project_id=${projectId}&zone_no=24`);

  const zoneButton = page.getByRole('button', { name: /Zone report/i });
  await expect(zoneButton).toBeVisible({ timeout: 15_000 });

  // 2. Open the dialog
  await zoneButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Generate/i })).toBeVisible();

  // 3. Submit with defaults (scope=zone, zone 24 pre-selected, last 30 days)
  await dialog.getByRole('button', { name: /Generate/i }).click();

  // 4. Wait for confirmation — report_number visible
  await expect(page.getByText(/SCOPE-/)).toBeVisible({ timeout: 60_000 });
  const pdfLink = page.getByRole('link', { name: /Open PDF/i });
  await expect(pdfLink).toBeVisible();
  const excelLink = page.getByRole('link', { name: /Download Excel/i });
  await expect(excelLink).toBeVisible();

  // 5. PDF URL is reachable
  const pdfHref = await pdfLink.getAttribute('href');
  expect(pdfHref).toBeTruthy();
  expect(pdfHref!).toMatch(/^(https?:\/\/|\/storage\/)/);

  // Construct absolute URL if relative
  const url = new URL(page.url());
  const absolutePdf = pdfHref!.startsWith('http')
    ? pdfHref!
    : `${url.protocol}//${url.host}${pdfHref}`;
  const headRes = await request.get(absolutePdf, { maxRedirects: 5 });
  expect(headRes.status()).toBeLessThan(400);

  // 6. Library — switch to Scoped filter
  await page.goto(`/field-ops/snags/reports?projectId=${projectId}`);
  const scopedChip = page.getByRole('button', { name: /^Scoped$/i });
  await expect(scopedChip).toBeVisible({ timeout: 10_000 });
  await scopedChip.click();

  // 7. The newly generated report (SCOPE-LAWL-…) should be visible
  await expect(page.getByText(/SCOPE-LAWL-/).first()).toBeVisible({ timeout: 10_000 });
});
