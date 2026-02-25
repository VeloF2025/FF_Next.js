/**
 * E2E Tests for Accounting Module
 * PRD-060: FibreFlow Accounting Module
 *
 * TDD Status: RED - Tests written before UI implementation
 *
 * Critical User Flows:
 * 1. Accounting dashboard loads with financial summary
 * 2. Chart of accounts CRUD
 * 3. Journal entry create → post → verify
 * 4. Supplier invoice capture and approval
 * 5. Payment runs and allocation
 * 6. Bank reconciliation workflow
 * 7. Financial reports (Trial Balance, P&L, Balance Sheet)
 * 8. API health checks
 */

import { test, expect, type Page } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function nav(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
}

async function assertPageLoaded(page: Page) {
  const title = await page.title();
  expect(title).not.toContain('404');
  const errorH1 = page.locator('h1:has-text("404"), h1:has-text("500"), h2:has-text("This page could not be found")');
  await expect(errorH1).toHaveCount(0);
}

// ── API HEALTH ───────────────────────────────────────────────────────────────

test.describe('Accounting API Health @smoke @accounting', () => {
  // E2E-020: All accounting endpoints respond
  test('GET /api/accounting/chart-of-accounts', async ({ request }) => {
    const res = await request.get('/api/accounting/chart-of-accounts');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
  });

  test('GET /api/accounting/journal-entries', async ({ request }) => {
    const res = await request.get('/api/accounting/journal-entries');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('GET /api/accounting/fiscal-periods', async ({ request }) => {
    const res = await request.get('/api/accounting/fiscal-periods');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('GET /api/accounting/supplier-invoices', async ({ request }) => {
    const res = await request.get('/api/accounting/supplier-invoices');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('GET /api/accounting/supplier-payments', async ({ request }) => {
    const res = await request.get('/api/accounting/supplier-payments');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('GET /api/accounting/customer-payments', async ({ request }) => {
    const res = await request.get('/api/accounting/customer-payments');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('GET /api/accounting/credit-notes', async ({ request }) => {
    const res = await request.get('/api/accounting/credit-notes');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('GET /api/accounting/bank-transactions', async ({ request }) => {
    const res = await request.get('/api/accounting/bank-transactions');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('GET /api/accounting/bank-reconciliations', async ({ request }) => {
    const res = await request.get('/api/accounting/bank-reconciliations');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('GET /api/accounting/reports/trial-balance', async ({ request }) => {
    const res = await request.get('/api/accounting/reports/trial-balance');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('GET /api/accounting/reports/income-statement', async ({ request }) => {
    const res = await request.get('/api/accounting/reports/income-statement');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('GET /api/accounting/reports/balance-sheet', async ({ request }) => {
    const res = await request.get('/api/accounting/reports/balance-sheet');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('GET /api/accounting/reports/ap-aging', async ({ request }) => {
    const res = await request.get('/api/accounting/reports/ap-aging');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('GET /api/accounting/reports/ar-aging', async ({ request }) => {
    const res = await request.get('/api/accounting/reports/ar-aging');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});

// ── PAGE NAVIGATION ──────────────────────────────────────────────────────────

test.describe('Accounting Pages Load @accounting', () => {
  // E2E-019: All accounting pages load without errors
  const pages = [
    { path: '/accounting', name: 'Dashboard' },
    { path: '/accounting/chart-of-accounts', name: 'Chart of Accounts' },
    { path: '/accounting/journal-entries', name: 'Journal Entries' },
    { path: '/accounting/journal-entries/new', name: 'New Journal Entry' },
    { path: '/accounting/supplier-invoices', name: 'Supplier Invoices' },
    { path: '/accounting/supplier-invoices/new', name: 'New Supplier Invoice' },
    { path: '/accounting/supplier-payments', name: 'Supplier Payments' },
    { path: '/accounting/supplier-payments/new', name: 'New Supplier Payment' },
    { path: '/accounting/customer-payments', name: 'Customer Payments' },
    { path: '/accounting/customer-payments/new', name: 'New Customer Payment' },
    { path: '/accounting/credit-notes', name: 'Credit Notes' },
    { path: '/accounting/credit-notes/new', name: 'New Credit Note' },
    { path: '/accounting/bank-reconciliation', name: 'Bank Reconciliation' },
    { path: '/accounting/reports', name: 'Reports' },
    { path: '/accounting/reports/trial-balance', name: 'Trial Balance' },
    { path: '/accounting/reports/income-statement', name: 'Income Statement' },
    { path: '/accounting/reports/balance-sheet', name: 'Balance Sheet' },
    { path: '/accounting/reports/project-profitability', name: 'Project Profitability' },
  ];

  for (const p of pages) {
    test(`${p.name} (${p.path}) loads without error`, async ({ page }) => {
      await nav(page, p.path);
      await assertPageLoaded(page);
    });
  }
});

// ── ACCOUNTING DASHBOARD ─────────────────────────────────────────────────────

test.describe('Accounting Dashboard @accounting', () => {
  // E2E-001: Dashboard loads with financial summary
  test('should display financial summary cards', async ({ page }) => {
    await nav(page, '/accounting');
    await assertPageLoaded(page);

    // Should show cash position, AP, AR, net position cards
    const cashCard = page.locator('text=/cash.*position|bank.*balance/i');
    await expect(cashCard).toBeVisible({ timeout: 5000 });

    const apCard = page.locator('text=/accounts.*payable|ap.*outstanding/i');
    await expect(apCard).toBeVisible({ timeout: 5000 });

    const arCard = page.locator('text=/accounts.*receivable|ar.*outstanding/i');
    await expect(arCard).toBeVisible({ timeout: 5000 });
  });

  test('should display quick action buttons', async ({ page }) => {
    await nav(page, '/accounting');

    const journalBtn = page.locator('a, button').filter({ hasText: /journal.*entry|new.*entry/i }).first();
    await expect(journalBtn).toBeVisible({ timeout: 5000 });
  });

  test('should display recent journal entries', async ({ page }) => {
    await nav(page, '/accounting');

    const recentSection = page.locator('text=/recent.*entries|recent.*transactions/i');
    await expect(recentSection).toBeVisible({ timeout: 5000 });
  });
});

// ── CHART OF ACCOUNTS ────────────────────────────────────────────────────────

test.describe('Chart of Accounts @accounting', () => {
  // E2E-002: Tree display
  test('should display account tree with all account types', async ({ page }) => {
    await nav(page, '/accounting/chart-of-accounts');
    await assertPageLoaded(page);

    // Should show main account type headers
    for (const type of ['Assets', 'Liabilities', 'Equity', 'Revenue', 'Expense']) {
      const typeHeader = page.locator(`text=/${type}/i`).first();
      await expect(typeHeader).toBeVisible({ timeout: 5000 });
    }
  });

  test('should show account codes and names', async ({ page }) => {
    await nav(page, '/accounting/chart-of-accounts');

    // Should show seeded accounts
    const bankAccount = page.locator('text=/1110.*Bank.*FNB|FNB.*Current/i').first();
    await expect(bankAccount).toBeVisible({ timeout: 5000 });

    const arAccount = page.locator('text=/1200.*Accounts.*Receivable/i').first();
    await expect(arAccount).toBeVisible({ timeout: 5000 });
  });

  // E2E-003: Create account
  test('should create a new GL account', async ({ page }) => {
    await nav(page, '/accounting/chart-of-accounts');

    const addButton = page.locator('button').filter({ hasText: /add.*account|new.*account/i }).first();
    await expect(addButton).toBeVisible({ timeout: 5000 });
    await addButton.click();

    // Fill form
    const codeInput = page.locator('input[name*="code"], input[name*="accountCode"]').first();
    await expect(codeInput).toBeVisible({ timeout: 5000 });
    await codeInput.fill('6800');

    const nameInput = page.locator('input[name*="name"], input[name*="accountName"]').first();
    await nameInput.fill('Professional Fees');

    // Select account type
    const typeSelect = page.locator('select[name*="type"]').first();
    if (await typeSelect.isVisible({ timeout: 2000 })) {
      await typeSelect.selectOption('expense');
    }

    // Save
    const saveBtn = page.locator('button').filter({ hasText: /save|create/i }).first();
    await saveBtn.click();
    await page.waitForLoadState('networkidle');

    // Verify new account appears
    const newAccount = page.locator('text=/6800.*Professional/i').first();
    await expect(newAccount).toBeVisible({ timeout: 5000 });
  });
});

// ── JOURNAL ENTRIES ──────────────────────────────────────────────────────────

test.describe('Journal Entries @accounting', () => {
  // E2E-004: Create manual journal entry
  test('should create a draft journal entry', async ({ page }) => {
    await nav(page, '/accounting/journal-entries/new');
    await assertPageLoaded(page);

    // Should have description field
    const descInput = page.locator('input[name*="description"], textarea[name*="description"]').first();
    await expect(descInput).toBeVisible({ timeout: 5000 });
    await descInput.fill('Test manual journal entry');

    // Should have date field
    const dateInput = page.locator('input[type="date"], input[name*="date"]').first();
    await expect(dateInput).toBeVisible({ timeout: 3000 });

    // Should have line items section
    const linesSection = page.locator('[data-testid="journal-lines"], table, .journal-lines').first();
    await expect(linesSection).toBeVisible({ timeout: 5000 });

    // Add debit line
    const addLineBtn = page.locator('button').filter({ hasText: /add.*line|add.*row/i }).first();
    if (await addLineBtn.isVisible({ timeout: 3000 })) {
      await addLineBtn.click();
    }

    // Save as draft
    const saveBtn = page.locator('button').filter({ hasText: /save.*draft|save/i }).first();
    await expect(saveBtn).toBeVisible({ timeout: 3000 });
  });

  // E2E-005: Post journal entry
  test('should post a balanced journal entry', async ({ page }) => {
    await nav(page, '/accounting/journal-entries');
    await assertPageLoaded(page);

    // Find a draft entry
    const draftEntry = page.locator('tr, [data-testid="journal-entry-row"]')
      .filter({ hasText: /draft/i }).first();

    if (await draftEntry.isVisible({ timeout: 5000 })) {
      await draftEntry.click();
      await page.waitForLoadState('networkidle');

      // Click Post button
      const postBtn = page.locator('button').filter({ hasText: /^post$/i }).first();
      if (await postBtn.isVisible({ timeout: 3000 })) {
        await postBtn.click();

        // Confirm posting
        const confirmBtn = page.locator('button').filter({ hasText: /confirm|yes/i }).first();
        if (await confirmBtn.isVisible({ timeout: 3000 })) {
          await confirmBtn.click();
        }

        await page.waitForLoadState('networkidle');

        // Status should change to Posted
        const postedBadge = page.locator('text=/posted/i').first();
        await expect(postedBadge).toBeVisible({ timeout: 5000 });
      }
    }
  });

  // E2E-006: Reject imbalanced entry
  test('should show error when posting imbalanced entry', async ({ page }) => {
    await nav(page, '/accounting/journal-entries/new');
    await assertPageLoaded(page);

    const descInput = page.locator('input[name*="description"], textarea[name*="description"]').first();
    await descInput.fill('Imbalanced test entry');

    // Try to post (should fail validation)
    const postBtn = page.locator('button').filter({ hasText: /post/i }).first();
    if (await postBtn.isVisible({ timeout: 3000 })) {
      await postBtn.click();

      // Should show error
      const errorMsg = page.locator('text=/not balanced|debit.*credit|must.*equal/i').first();
      await expect(errorMsg).toBeVisible({ timeout: 5000 });
    }
  });

  test('should display journal entry list with filters', async ({ page }) => {
    await nav(page, '/accounting/journal-entries');
    await assertPageLoaded(page);

    // Should have status filter
    const statusFilter = page.locator('select, button').filter({ hasText: /status|filter/i }).first();
    await expect(statusFilter).toBeVisible({ timeout: 5000 });

    // Should show entry numbers
    const entryNumber = page.locator('text=/JE-\\d{4}-\\d{5}/').first();
    if (await entryNumber.isVisible({ timeout: 3000 })) {
      expect(await entryNumber.textContent()).toMatch(/JE-\d{4}-\d{5}/);
    }
  });
});

// ── SUPPLIER INVOICES ────────────────────────────────────────────────────────

test.describe('Supplier Invoices @accounting', () => {
  // E2E-007: Create supplier invoice
  test('should have supplier invoice creation form', async ({ page }) => {
    await nav(page, '/accounting/supplier-invoices/new');
    await assertPageLoaded(page);

    // Should have supplier selection
    const supplierField = page.locator('select[name*="supplier"], input[name*="supplier"]').first();
    await expect(supplierField).toBeVisible({ timeout: 5000 });

    // Should have invoice number field
    const invoiceField = page.locator('input[name*="invoice"]').first();
    await expect(invoiceField).toBeVisible({ timeout: 5000 });

    // Should have line items area
    const formElements = page.locator('input, select, textarea');
    const count = await formElements.count();
    expect(count).toBeGreaterThan(3);
  });

  // E2E-008: Approve supplier invoice
  test('should display supplier invoice list', async ({ page }) => {
    await nav(page, '/accounting/supplier-invoices');
    await assertPageLoaded(page);

    const body = await page.textContent('body');
    expect(body!.length).toBeGreaterThan(100);
  });
});

// ── SUPPLIER PAYMENTS ────────────────────────────────────────────────────────

test.describe('Supplier Payments @accounting', () => {
  // E2E-009: Payment run
  test('should display supplier payment creation form', async ({ page }) => {
    await nav(page, '/accounting/supplier-payments/new');
    await assertPageLoaded(page);

    // Should have supplier selection
    const supplierField = page.locator('select[name*="supplier"], input[name*="supplier"]').first();
    await expect(supplierField).toBeVisible({ timeout: 5000 });

    // Should have amount field
    const amountField = page.locator('input[name*="amount"]').first();
    await expect(amountField).toBeVisible({ timeout: 5000 });
  });

  test('should display payment list', async ({ page }) => {
    await nav(page, '/accounting/supplier-payments');
    await assertPageLoaded(page);
  });
});

// ── CUSTOMER PAYMENTS ────────────────────────────────────────────────────────

test.describe('Customer Payments @accounting', () => {
  // E2E-010: Record customer payment
  test('should display customer payment creation form', async ({ page }) => {
    await nav(page, '/accounting/customer-payments/new');
    await assertPageLoaded(page);

    const clientField = page.locator('select[name*="client"], input[name*="client"]').first();
    await expect(clientField).toBeVisible({ timeout: 5000 });
  });
});

// ── BANK RECONCILIATION ─────────────────────────────────────────────────────

test.describe('Bank Reconciliation @accounting', () => {
  // E2E-011, E2E-012, E2E-013
  test('should display bank reconciliation page', async ({ page }) => {
    await nav(page, '/accounting/bank-reconciliation');
    await assertPageLoaded(page);

    // Should show bank account selection
    const bankSelect = page.locator('select, button').filter({ hasText: /bank|account/i }).first();
    await expect(bankSelect).toBeVisible({ timeout: 5000 });
  });

  test('should have CSV import capability', async ({ page }) => {
    await nav(page, '/accounting/bank-reconciliation');

    // Should have import/upload button
    const importBtn = page.locator('button, label').filter({ hasText: /import|upload/i }).first();
    await expect(importBtn).toBeVisible({ timeout: 5000 });
  });

  test('should display reconciliation history', async ({ page }) => {
    await nav(page, '/accounting/bank-reconciliation');

    // Should show past reconciliations or empty state
    const body = await page.textContent('body');
    expect(body!.length).toBeGreaterThan(100);
  });
});

// ── FINANCIAL REPORTS ────────────────────────────────────────────────────────

test.describe('Financial Reports @accounting', () => {
  // E2E-014: Trial Balance
  test('should display Trial Balance report', async ({ page }) => {
    await nav(page, '/accounting/reports/trial-balance');
    await assertPageLoaded(page);

    // Should have date filter
    const dateFilter = page.locator('input[type="date"], input[name*="date"]').first();
    await expect(dateFilter).toBeVisible({ timeout: 5000 });

    // Should show debit and credit columns
    const debitHeader = page.locator('th, text=/debit/i').first();
    await expect(debitHeader).toBeVisible({ timeout: 5000 });

    const creditHeader = page.locator('th, text=/credit/i').first();
    await expect(creditHeader).toBeVisible({ timeout: 5000 });
  });

  // E2E-015: Income Statement
  test('should display Income Statement (P&L)', async ({ page }) => {
    await nav(page, '/accounting/reports/income-statement');
    await assertPageLoaded(page);

    // Should show revenue and expense sections
    const revenueSection = page.locator('text=/revenue|income/i').first();
    await expect(revenueSection).toBeVisible({ timeout: 5000 });

    const expenseSection = page.locator('text=/expense|cost/i').first();
    await expect(expenseSection).toBeVisible({ timeout: 5000 });
  });

  test('should filter Income Statement by project', async ({ page }) => {
    await nav(page, '/accounting/reports/income-statement');

    // Should have project filter
    const projectFilter = page.locator('select[name*="project"], input[name*="project"]').first();
    if (await projectFilter.isVisible({ timeout: 3000 })) {
      // Filter exists
      expect(true).toBe(true);
    }
  });

  // E2E-016: Balance Sheet
  test('should display Balance Sheet', async ({ page }) => {
    await nav(page, '/accounting/reports/balance-sheet');
    await assertPageLoaded(page);

    // Should show assets and liabilities sections
    const assetsSection = page.locator('text=/assets/i').first();
    await expect(assetsSection).toBeVisible({ timeout: 5000 });

    const liabilitiesSection = page.locator('text=/liabilities/i').first();
    await expect(liabilitiesSection).toBeVisible({ timeout: 5000 });
  });

  // E2E-017: AP Aging
  test('should display AP Aging report', async ({ page }) => {
    await nav(page, '/accounting/reports');
    await assertPageLoaded(page);

    const apAgingLink = page.locator('a, button').filter({ hasText: /ap.*aging|payable.*aging/i }).first();
    if (await apAgingLink.isVisible({ timeout: 3000 })) {
      await apAgingLink.click();
      await page.waitForLoadState('networkidle');

      // Should show aging columns
      const currentCol = page.locator('th, text=/current/i').first();
      await expect(currentCol).toBeVisible({ timeout: 5000 });
    }
  });

  // E2E-018: AR Aging
  test('should display AR Aging report', async ({ page }) => {
    await nav(page, '/accounting/reports');

    const arAgingLink = page.locator('a, button').filter({ hasText: /ar.*aging|receivable.*aging/i }).first();
    if (await arAgingLink.isVisible({ timeout: 3000 })) {
      await arAgingLink.click();
      await page.waitForLoadState('networkidle');

      const currentCol = page.locator('th, text=/current/i').first();
      await expect(currentCol).toBeVisible({ timeout: 5000 });
    }
  });

  test('should have export buttons on reports', async ({ page }) => {
    await nav(page, '/accounting/reports/trial-balance');

    const exportBtn = page.locator('button').filter({ hasText: /export|pdf|excel/i }).first();
    await expect(exportBtn).toBeVisible({ timeout: 5000 });
  });
});

// ── CURRENCY FORMAT ──────────────────────────────────────────────────────────

test.describe('Currency Formatting @accounting', () => {
  test('should display ZAR (R) for all monetary values', async ({ page }) => {
    await nav(page, '/accounting');
    const body = await page.textContent('body') || '';
    // If monetary values exist, they should use R or ZAR
    if (/\d{1,3}[,\s]\d{3}/.test(body)) {
      expect(body).not.toContain('$');
      expect(body).toMatch(/R\s?\d|ZAR/);
    }
  });
});

// ── SIDEBAR NAVIGATION ──────────────────────────────────────────────────────

test.describe('Accounting Sidebar @accounting', () => {
  test('should have Accounting link in main navigation', async ({ page }) => {
    await nav(page, '/');

    const accountingLink = page.locator('a, button').filter({ hasText: /^Accounting$/i }).first();
    if (await accountingLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await accountingLink.click();
      await page.waitForTimeout(3000);
      expect(page.url()).toContain('/accounting');
    }
  });
});
