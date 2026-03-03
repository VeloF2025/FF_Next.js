/**
 * Bank Categorisation Rules — CRUD smoke test
 * Tests the rules page at /accounting/bank-reconciliation/rules
 */

import { test, expect } from '@playwright/test';

const RULE_NAME = `Test Rule ${Date.now()}`;
const UPDATED_NAME = `Updated Rule ${Date.now()}`;

test.describe('Bank Rules CRUD', () => {
  test('page loads and shows table', async ({ page }) => {
    await page.goto('/accounting/bank-reconciliation/rules');
    await page.screenshot({ path: 'tests/screenshots/rules-01-load.png', fullPage: true });

    // Check heading
    await expect(page.getByRole('heading', { name: 'Categorisation Rules' })).toBeVisible();

    // Check table headers — scope to <th> elements to avoid strict-mode conflicts
    await expect(page.locator('th', { hasText: 'Rule' }).first()).toBeVisible();
    await expect(page.locator('th', { hasText: 'Pattern' })).toBeVisible();
    await expect(page.locator('th', { hasText: 'GL Account' })).toBeVisible();

    console.log('✅ Page loaded OK');
  });

  test('create a new rule', async ({ page }) => {
    await page.goto('/accounting/bank-reconciliation/rules');

    // Click New Rule
    await page.getByRole('button', { name: 'New Rule' }).click();
    await page.screenshot({ path: 'tests/screenshots/rules-02-form-open.png', fullPage: true });

    // Fill form
    await page.locator('input[placeholder="Rule Name *"]').fill(RULE_NAME);
    await page.locator('input[placeholder="Pattern (e.g. WOOLWORTHS) *"]').fill('PLAYWRIGHT_TEST');

    // Select a GL Account — wait for options to load
    const glSelect = page.locator('select').filter({ hasText: 'Select GL Account' });
    await glSelect.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

    // Take screenshot to see what state the form is in
    await page.screenshot({ path: 'tests/screenshots/rules-03-form-filled.png', fullPage: true });

    // Count GL account options
    const optCount = await glSelect.locator('option').count();
    console.log(`GL account options available: ${optCount}`);

    if (optCount > 1) {
      await glSelect.selectOption({ index: 1 });
    }

    // Submit
    await page.getByRole('button', { name: 'Create Rule' }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'tests/screenshots/rules-04-after-create.png', fullPage: true });

    // Check error state — use the specific error banner, not all red elements
    const errorBanner = page.locator('div.bg-red-500\\/10.text-red-400');
    const hasError = await errorBanner.isVisible().catch(() => false);
    if (hasError) {
      const errorText = await errorBanner.textContent();
      console.log(`❌ Create error: ${errorText}`);
    } else {
      // Check new rule appears in table
      const ruleInTable = await page.getByText(RULE_NAME).count();
      console.log(`Rule in table after create: ${ruleInTable > 0 ? '✅ YES' : '❌ NO'}`);
    }
  });

  test('edit an existing rule', async ({ page }) => {
    await page.goto('/accounting/bank-reconciliation/rules');
    await page.waitForTimeout(1000);

    // Count rules
    const rows = page.locator('tbody tr');
    const rowCount = await rows.count();
    console.log(`Total rules in table: ${rowCount}`);
    await page.screenshot({ path: 'tests/screenshots/rules-05-list.png', fullPage: true });

    if (rowCount === 0) {
      console.log('⚠️  No rules to edit — skipping');
      return;
    }

    // Click the first pencil/edit button
    const editBtn = page.locator('button[title="Edit"]').first();
    const editCount = await editBtn.count();
    console.log(`Edit buttons found: ${editCount}`);

    if (editCount === 0) {
      console.log('❌ No edit buttons found');
      return;
    }

    await editBtn.click();
    await page.screenshot({ path: 'tests/screenshots/rules-06-edit-form.png', fullPage: true });

    // Check form opened with editing title
    const editTitle = await page.getByText('Edit Categorisation Rule').count();
    console.log(`Edit form opened: ${editTitle > 0 ? '✅' : '❌'}`);

    // Modify the rule name
    const nameInput = page.locator('input[placeholder="Rule Name *"]');
    await nameInput.clear();
    await nameInput.fill(UPDATED_NAME);

    await page.getByRole('button', { name: 'Save Changes' }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'tests/screenshots/rules-07-after-edit.png', fullPage: true });

    const errorBanner = page.locator('div.bg-red-500\\/10.text-red-400');
    const hasError = await errorBanner.isVisible().catch(() => false);
    if (hasError) {
      console.log(`❌ Edit error: ${await errorBanner.textContent()}`);
    } else {
      console.log('✅ Edit saved');
    }
  });

  test('toggle rule active/inactive', async ({ page }) => {
    await page.goto('/accounting/bank-reconciliation/rules');
    await page.waitForTimeout(1000);

    const toggleBtn = page.locator('button[title="Disable"], button[title="Enable"]').first();
    const count = await toggleBtn.count();
    console.log(`Toggle buttons found: ${count}`);

    if (count === 0) {
      console.log('⚠️  No toggle buttons found');
      return;
    }

    const titleBefore = await toggleBtn.getAttribute('title');
    await toggleBtn.click();
    await page.waitForTimeout(1500);

    await page.screenshot({ path: 'tests/screenshots/rules-08-after-toggle.png', fullPage: true });
    console.log(`✅ Toggled from "${titleBefore}"`);
  });

  test('delete a rule', async ({ page }) => {
    await page.goto('/accounting/bank-reconciliation/rules');
    await page.waitForTimeout(1000);

    const rowsBefore = await page.locator('tbody tr').count();
    console.log(`Rules before delete: ${rowsBefore}`);

    if (rowsBefore === 0) {
      console.log('⚠️  No rules to delete');
      return;
    }

    // Accept confirmation dialog
    page.on('dialog', d => d.accept());

    const deleteBtn = page.locator('button[title="Delete"]').first();
    const delCount = await deleteBtn.count();
    console.log(`Delete buttons found: ${delCount}`);

    if (delCount === 0) {
      console.log('❌ No delete buttons found');
      return;
    }

    await deleteBtn.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'tests/screenshots/rules-09-after-delete.png', fullPage: true });

    const rowsAfter = await page.locator('tbody tr').count();
    console.log(`Rules after delete: ${rowsAfter} (was ${rowsBefore}) ${rowsAfter < rowsBefore ? '✅' : '❌'}`);
  });

  test('bulk delete rules', async ({ page }) => {
    await page.goto('/accounting/bank-reconciliation/rules');
    await page.waitForTimeout(1000);

    const rowsBefore = await page.locator('tbody tr').count();
    console.log(`Rules before bulk delete: ${rowsBefore}`);

    if (rowsBefore < 2) {
      console.log('⚠️  Not enough rules to test bulk delete');
      return;
    }

    // Check 3 checkboxes (rows 1, 2, 3)
    const checkboxes = page.locator('tbody input[type="checkbox"]');
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();
    await checkboxes.nth(2).check();

    await page.screenshot({ path: 'tests/screenshots/rules-11-bulk-selected.png', fullPage: true });

    // Bulk delete button should appear
    const bulkBtn = page.getByRole('button', { name: /Delete 3 selected/i });
    await expect(bulkBtn).toBeVisible();
    console.log('✅ Bulk delete button visible with 3 selected');

    // Accept confirm dialog and click
    page.on('dialog', d => d.accept());
    await bulkBtn.click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'tests/screenshots/rules-12-after-bulk-delete.png', fullPage: true });

    const rowsAfter = await page.locator('tbody tr').count();
    console.log(`Rules after bulk delete: ${rowsAfter} (was ${rowsBefore}) ${rowsAfter === rowsBefore - 3 ? '✅' : '❌'}`);
  });

  test('select all checkbox', async ({ page }) => {
    await page.goto('/accounting/bank-reconciliation/rules');
    await page.waitForTimeout(1000);

    const rowCount = await page.locator('tbody tr').count();
    if (rowCount === 0) { console.log('⚠️  No rules'); return; }

    // Click select-all in thead
    const selectAll = page.locator('thead input[type="checkbox"]');
    await selectAll.check();
    await page.waitForTimeout(300);

    // All row checkboxes should be checked
    const allChecked = await page.locator('tbody input[type="checkbox"]:checked').count();
    console.log(`Select all: ${allChecked}/${rowCount} checked ${allChecked === rowCount ? '✅' : '❌'}`);

    // Bulk delete button shows total
    const bulkBtn = page.getByRole('button', { name: new RegExp(`Delete ${rowCount} selected`) });
    const visible = await bulkBtn.isVisible().catch(() => false);
    console.log(`Bulk button shows correct count: ${visible ? '✅' : '❌'}`);

    // Uncheck all
    await selectAll.uncheck();
    const noneChecked = await page.locator('tbody input[type="checkbox"]:checked').count();
    console.log(`Uncheck all: ${noneChecked === 0 ? '✅' : '❌'} (${noneChecked} still checked)`);
  });

  test('apply rules button', async ({ page }) => {
    await page.goto('/accounting/bank-reconciliation/rules');

    const applyBtn = page.getByRole('button', { name: 'Apply Rules' });
    await expect(applyBtn).toBeVisible();

    // Wait for bank accounts to load (button becomes enabled when selectedBankId is set)
    await expect(applyBtn).toBeEnabled({ timeout: 8000 });
    console.log('✅ Apply Rules button enabled');

    // Wait for the API response — rules now run in parallel so should be fast
    const [response] = await Promise.all([
      page.waitForResponse(
        r => r.url().includes('bank-rules-action') && r.request().method() === 'POST',
        { timeout: 60000 }
      ),
      applyBtn.click(),
    ]);

    const responseBody = await response.json().catch(() => null);
    console.log(`Apply API status: ${response.status()}`);
    if (responseBody?.data) {
      console.log(`Apply result: ${responseBody.data.applied} categorised, ${responseBody.data.skipped} skipped`);
    }

    // Wait for React to re-render the banner
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tests/screenshots/rules-10-after-apply.png', fullPage: true });

    // Check for result banner
    const resultBanner = page.locator('div.bg-emerald-500\\/10.text-emerald-400').first();
    const bannerVisible = await resultBanner.isVisible().catch(() => false);
    console.log(`Apply result banner: ${bannerVisible ? '✅ shown' : '⚠️  not shown'}`);
    if (bannerVisible) {
      console.log(`  Banner: ${await resultBanner.textContent()}`);
    }
  });
});
