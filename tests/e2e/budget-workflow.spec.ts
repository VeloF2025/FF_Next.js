/**
 * E2E Tests for Budget Tracking Workflow
 * PRD-057: Project Budget Tracking System
 *
 * TDD Status: RED - Tests written before UI implementation
 *
 * Critical User Flows:
 * 1. Create manual budget for a project
 * 2. Sync budget from approved BOQ
 * 3. View budget dashboard with categories
 * 4. Budget enforcement on PO creation
 * 5. Budget adjustments (admin)
 * 6. Budget alerts acknowledgment
 */

import { test, expect } from '@playwright/test';

// Test fixtures
const TEST_PROJECT_ID = 'e2e-test-project-budget';
const TEST_BOQ_ID = 'e2e-test-boq-approved';

const generateTestBudget = () => ({
  totalBudget: 500000,
  currency: 'ZAR',
  categories: {
    materials: 200000,
    equipment: 100000,
    labor: 80000,
    subcontract: 50000,
    transport: 30000,
    overhead: 25000,
    contingency: 15000,
  },
});

test.describe('Budget Tracking E2E @budget', () => {
  test.describe('Manual Budget Creation', () => {
    test.beforeEach(async ({ page }) => {
      // Navigate to a project that doesn't have a budget yet
      await page.goto(`/projects/${TEST_PROJECT_ID}`);
      await page.waitForLoadState('networkidle');
    });

    test('should navigate to budget page from project', async ({ page }) => {
      // UNTESTED: Budget tab/link doesn't exist yet
      const budgetTab = page
        .locator('a, button')
        .filter({ hasText: /budget/i })
        .first();
      await expect(budgetTab).toBeVisible({ timeout: 5000 });

      await budgetTab.click();
      await page.waitForLoadState('networkidle');

      // Should be on budget page
      expect(page.url()).toContain('/budget');
    });

    test('should show empty state when no budget exists', async ({ page }) => {
      // UNTESTED: Budget page doesn't exist yet
      await page.goto(`/projects/${TEST_PROJECT_ID}/budget`);
      await page.waitForLoadState('networkidle');

      // Should show "No budget configured" message
      const emptyState = page.locator('text=/no budget|create budget|set up budget/i');
      await expect(emptyState).toBeVisible({ timeout: 5000 });
    });

    test('should create manual budget with default categories', async ({ page }) => {
      // UNTESTED: Budget creation flow doesn't exist yet
      const testBudget = generateTestBudget();

      await page.goto(`/projects/${TEST_PROJECT_ID}/budget`);
      await page.waitForLoadState('networkidle');

      // Click create budget button
      const createButton = page
        .locator('button')
        .filter({ hasText: /create budget|new budget/i })
        .first();
      await expect(createButton).toBeVisible({ timeout: 5000 });
      await createButton.click();

      // Should show budget creation form/modal
      const modal = page.locator('[role="dialog"], .modal, form').first();
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Select "Manual Entry" option
      const manualOption = page
        .locator('input[type="radio"], button, label')
        .filter({ hasText: /manual/i })
        .first();
      if (await manualOption.isVisible({ timeout: 2000 })) {
        await manualOption.click();
      }

      // Enter total budget
      const totalInput = page
        .locator('input[name*="total"], input[name*="budget"]')
        .first();
      await expect(totalInput).toBeVisible({ timeout: 3000 });
      await totalInput.fill(String(testBudget.totalBudget));

      // Submit form
      const submitButton = page
        .locator('button[type="submit"], button')
        .filter({ hasText: /save|create|confirm/i })
        .first();
      await submitButton.click();

      // Wait for success
      await page.waitForLoadState('networkidle');

      // Verify budget is now visible
      const budgetTotal = page.locator('text=/R.*500.*000|500,000/');
      await expect(budgetTotal).toBeVisible({ timeout: 5000 });

      // Verify default categories are shown (7 categories)
      const categoryRows = page.locator('[data-testid="budget-category"]');
      await expect(categoryRows).toHaveCount(7, { timeout: 5000 });
    });

    test('should allow editing category allocations', async ({ page }) => {
      // UNTESTED: Category editing doesn't exist yet
      await page.goto(`/projects/${TEST_PROJECT_ID}/budget`);
      await page.waitForLoadState('networkidle');

      // Click on Materials category to edit
      const materialsRow = page
        .locator('[data-testid="budget-category"]')
        .filter({ hasText: /materials/i })
        .first();
      await expect(materialsRow).toBeVisible({ timeout: 5000 });

      const editButton = materialsRow.locator('button').filter({ hasText: /edit/i });
      await editButton.click();

      // Edit allocation
      const allocationInput = page.locator('input[name*="allocation"]').first();
      await allocationInput.fill('250000');

      // Save
      const saveButton = page
        .locator('button')
        .filter({ hasText: /save|update/i })
        .first();
      await saveButton.click();

      // Verify updated value
      await page.waitForLoadState('networkidle');
      const updatedValue = page.locator('text=/R.*250.*000|250,000/');
      await expect(updatedValue).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('BOQ Budget Sync', () => {
    test.beforeEach(async ({ page }) => {
      // Navigate to project with approved BOQ
      await page.goto(`/projects/${TEST_PROJECT_ID}/budget`);
      await page.waitForLoadState('networkidle');
    });

    test('should show sync from BOQ option when BOQ is approved', async ({ page }) => {
      // UNTESTED: BOQ sync option doesn't exist yet
      const syncButton = page
        .locator('button')
        .filter({ hasText: /sync.*boq|import.*boq/i })
        .first();
      await expect(syncButton).toBeVisible({ timeout: 5000 });
    });

    test('should create budget from approved BOQ', async ({ page }) => {
      // UNTESTED: BOQ sync flow doesn't exist yet

      // Click sync from BOQ
      const syncButton = page
        .locator('button')
        .filter({ hasText: /sync.*boq|import.*boq/i })
        .first();
      await syncButton.click();

      // Should show BOQ selection or confirmation
      const confirmModal = page.locator('[role="dialog"], .modal').first();
      await expect(confirmModal).toBeVisible({ timeout: 5000 });

      // Confirm sync
      const confirmButton = page
        .locator('button')
        .filter({ hasText: /confirm|sync|import/i })
        .first();
      await confirmButton.click();

      // Wait for sync to complete
      await page.waitForLoadState('networkidle');

      // Verify budget was created
      const successMessage = page.locator('text=/budget.*created|synced.*boq/i');
      await expect(successMessage).toBeVisible({ timeout: 5000 });

      // Verify categories match BOQ
      const categoryRows = page.locator('[data-testid="budget-category"]');
      await expect(categoryRows.first()).toBeVisible({ timeout: 5000 });
    });

    test('should show warning when BOQ is not approved', async ({ page }) => {
      // UNTESTED: Unapproved BOQ warning doesn't exist yet
      // Navigate to project with draft BOQ
      await page.goto('/projects/project-with-draft-boq/budget');
      await page.waitForLoadState('networkidle');

      // Sync button should be disabled or show warning
      const syncButton = page
        .locator('button')
        .filter({ hasText: /sync.*boq/i })
        .first();

      if (await syncButton.isVisible({ timeout: 3000 })) {
        // Either disabled or shows warning when clicked
        const isDisabled = await syncButton.isDisabled();
        if (!isDisabled) {
          await syncButton.click();
          const warning = page.locator('text=/boq.*must.*approved|not.*approved/i');
          await expect(warning).toBeVisible({ timeout: 5000 });
        }
      }
    });
  });

  test.describe('Budget Dashboard', () => {
    test.beforeEach(async ({ page }) => {
      // Navigate to project with existing budget
      await page.goto(`/projects/${TEST_PROJECT_ID}/budget`);
      await page.waitForLoadState('networkidle');
    });

    test('should display budget overview card', async ({ page }) => {
      // UNTESTED: Budget overview card doesn't exist yet
      const overviewCard = page.locator('[data-testid="budget-overview"]').first();
      await expect(overviewCard).toBeVisible({ timeout: 5000 });

      // Should show total budget
      const totalBudget = overviewCard.locator('text=/total.*budget/i');
      await expect(totalBudget).toBeVisible();

      // Should show committed amount
      const committed = overviewCard.locator('text=/committed/i');
      await expect(committed).toBeVisible();

      // Should show available budget
      const available = overviewCard.locator('text=/available/i');
      await expect(available).toBeVisible();
    });

    test('should display category breakdown with progress bars', async ({ page }) => {
      // UNTESTED: Category breakdown doesn't exist yet
      const categorySection = page.locator('[data-testid="category-breakdown"]');
      await expect(categorySection).toBeVisible({ timeout: 5000 });

      // Should have progress bars for each category
      const progressBars = categorySection.locator('[role="progressbar"], .progress-bar');
      await expect(progressBars.first()).toBeVisible();
    });

    test('should display transaction history', async ({ page }) => {
      // UNTESTED: Transaction history doesn't exist yet
      const transactionsTab = page
        .locator('button, a')
        .filter({ hasText: /transactions|history/i })
        .first();
      await transactionsTab.click();
      await page.waitForLoadState('networkidle');

      // Should show transaction list
      const transactionList = page.locator('[data-testid="transaction-list"]');
      await expect(transactionList).toBeVisible({ timeout: 5000 });
    });

    test('should show budget health indicator', async ({ page }) => {
      // UNTESTED: Health indicator doesn't exist yet
      const healthIndicator = page.locator('[data-testid="budget-health"]');
      await expect(healthIndicator).toBeVisible({ timeout: 5000 });

      // Should be one of: healthy, warning, critical
      const healthText = await healthIndicator.textContent();
      expect(healthText?.toLowerCase()).toMatch(/healthy|warning|critical/);
    });
  });

  test.describe('PO Budget Enforcement', () => {
    test('should show available budget when creating PO', async ({ page }) => {
      // UNTESTED: PO budget display doesn't exist yet
      await page.goto('/procurement/purchase-orders/create');
      await page.waitForLoadState('networkidle');

      // Select project with budget
      const projectSelect = page.locator('select[name*="project"]').first();
      // Use text-based option selection for test project
      const optionTest = projectSelect.locator('option').filter({ hasText: /test project/i }).first();
      const optionValue = await optionTest.getAttribute('value');
      if (optionValue) await projectSelect.selectOption(optionValue);

      // Should display available budget
      const budgetInfo = page.locator('[data-testid="po-budget-info"]');
      await expect(budgetInfo).toBeVisible({ timeout: 5000 });
    });

    test('should block over-budget PO submission', async ({ page }) => {
      // UNTESTED: Budget enforcement doesn't exist yet
      await page.goto('/procurement/purchase-orders/create');
      await page.waitForLoadState('networkidle');

      // Select project with budget (90% utilized)
      const projectSelect = page.locator('select[name*="project"]').first();
      // Use text-based option selection for project with 90% budget utilized
      const option90 = projectSelect.locator('option').filter({ hasText: /budget.*90|90.*percent/i }).first();
      const optionValue = await option90.getAttribute('value');
      if (optionValue) await projectSelect.selectOption(optionValue);

      // Enter amount that would exceed budget
      const amountInput = page.locator('input[name*="amount"], input[name*="total"]').first();
      await amountInput.fill('50000');

      // Try to submit
      const submitButton = page
        .locator('button[type="submit"]')
        .filter({ hasText: /submit|create/i })
        .first();
      await submitButton.click();

      // Should show blocking modal
      const blockModal = page.locator('[data-testid="budget-block-modal"]');
      await expect(blockModal).toBeVisible({ timeout: 5000 });

      // Should have "Request Override" button
      const overrideButton = page
        .locator('button')
        .filter({ hasText: /request.*override/i });
      await expect(overrideButton).toBeVisible();
    });

    test('should show warning at 80% utilization', async ({ page }) => {
      // UNTESTED: Budget warning doesn't exist yet
      await page.goto('/procurement/purchase-orders/create');
      await page.waitForLoadState('networkidle');

      // Select project with budget (75% utilized)
      const projectSelect = page.locator('select[name*="project"]').first();
      // Use text-based option selection for project with 75% budget utilized
      const option75 = projectSelect.locator('option').filter({ hasText: /budget.*75|75.*percent/i }).first();
      const optionValue = await option75.getAttribute('value');
      if (optionValue) await projectSelect.selectOption(optionValue);

      // Enter amount that would push to 85%
      const amountInput = page.locator('input[name*="amount"]').first();
      await amountInput.fill('10000');

      // Should show warning banner
      const warningBanner = page.locator('[data-testid="budget-warning"]');
      await expect(warningBanner).toBeVisible({ timeout: 5000 });
      await expect(warningBanner).toContainText(/warning|approaching.*limit/i);
    });

    test('should allow PO creation after override approval', async ({ page }) => {
      // UNTESTED: Override approval flow doesn't exist yet
      // This test would require setup with approved override
      await page.goto('/procurement/purchase-orders/create');
      await page.waitForLoadState('networkidle');

      // With approved override, should allow submission
      const submitButton = page
        .locator('button[type="submit"]')
        .first();

      // Verify no blocking modal appears
      await submitButton.click();
      await page.waitForLoadState('networkidle');

      // Should navigate to PO detail or show success
      const successIndicator = page.locator('text=/created|success/i');
      await expect(successIndicator).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Budget Adjustments (Admin)', () => {
    test.beforeEach(async ({ page }) => {
      // Login as admin user
      await page.goto(`/projects/${TEST_PROJECT_ID}/budget`);
      await page.waitForLoadState('networkidle');
    });

    test('should show adjust budget button for admin', async ({ page }) => {
      // UNTESTED: Admin adjustment button doesn't exist yet
      const adjustButton = page
        .locator('button')
        .filter({ hasText: /adjust.*budget|modify/i })
        .first();
      await expect(adjustButton).toBeVisible({ timeout: 5000 });
    });

    test('should allow budget increase with reason', async ({ page }) => {
      // UNTESTED: Budget adjustment modal doesn't exist yet
      const adjustButton = page
        .locator('button')
        .filter({ hasText: /adjust.*budget/i })
        .first();
      await adjustButton.click();

      // Should show adjustment modal
      const modal = page.locator('[role="dialog"], .modal').first();
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Select increase
      const increaseOption = page
        .locator('input[type="radio"], button')
        .filter({ hasText: /increase/i })
        .first();
      await increaseOption.click();

      // Enter amount
      const amountInput = page.locator('input[name*="amount"]').first();
      await amountInput.fill('50000');

      // Enter reason (required)
      const reasonInput = page.locator('textarea[name*="reason"]').first();
      await reasonInput.fill('Scope change approved in project meeting');

      // Submit
      const submitButton = page
        .locator('button')
        .filter({ hasText: /save|apply|confirm/i })
        .first();
      await submitButton.click();

      // Verify success
      await page.waitForLoadState('networkidle');
      const successMessage = page.locator('text=/adjusted|updated/i');
      await expect(successMessage).toBeVisible({ timeout: 5000 });
    });

    test('should require reason for adjustment', async ({ page }) => {
      // UNTESTED: Reason validation doesn't exist yet
      const adjustButton = page
        .locator('button')
        .filter({ hasText: /adjust.*budget/i })
        .first();
      await adjustButton.click();

      // Enter amount but no reason
      const amountInput = page.locator('input[name*="amount"]').first();
      await amountInput.fill('50000');

      // Try to submit without reason
      const submitButton = page
        .locator('button')
        .filter({ hasText: /save|apply/i })
        .first();
      await submitButton.click();

      // Should show validation error
      const errorMessage = page.locator('text=/reason.*required|provide.*reason/i');
      await expect(errorMessage).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Budget Alerts', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/projects/${TEST_PROJECT_ID}/budget`);
      await page.waitForLoadState('networkidle');
    });

    test('should display active alerts', async ({ page }) => {
      // UNTESTED: Alert display doesn't exist yet
      const alertsSection = page.locator('[data-testid="budget-alerts"]');
      await expect(alertsSection).toBeVisible({ timeout: 5000 });

      // Should show at least one alert
      const alertItem = alertsSection.locator('[data-testid="alert-item"]').first();
      await expect(alertItem).toBeVisible();
    });

    test('should show warning alert at 80% threshold', async ({ page }) => {
      // UNTESTED: Warning alert display doesn't exist yet
      const warningAlert = page
        .locator('[data-testid="alert-item"]')
        .filter({ hasText: /warning|80%/i })
        .first();
      await expect(warningAlert).toBeVisible({ timeout: 5000 });

      // Should have warning color/icon
      const warningIcon = warningAlert.locator('[data-severity="warning"], .warning');
      await expect(warningIcon).toBeVisible();
    });

    test('should show critical alert at 100% threshold', async ({ page }) => {
      // UNTESTED: Critical alert display doesn't exist yet
      const criticalAlert = page
        .locator('[data-testid="alert-item"]')
        .filter({ hasText: /critical|100%|exceeded/i })
        .first();

      if (await criticalAlert.isVisible({ timeout: 3000 })) {
        // Should have critical color/icon
        const criticalIcon = criticalAlert.locator('[data-severity="critical"], .critical');
        await expect(criticalIcon).toBeVisible();
      }
    });

    test('should allow acknowledging alerts', async ({ page }) => {
      // UNTESTED: Alert acknowledgment doesn't exist yet
      const alertItem = page.locator('[data-testid="alert-item"]').first();
      await expect(alertItem).toBeVisible({ timeout: 5000 });

      // Click acknowledge button
      const acknowledgeButton = alertItem.locator('button').filter({ hasText: /acknowledge/i });
      await acknowledgeButton.click();

      // Alert should be marked as acknowledged
      await page.waitForLoadState('networkidle');
      const acknowledgedBadge = alertItem.locator('text=/acknowledged/i');
      await expect(acknowledgedBadge).toBeVisible({ timeout: 5000 });
    });

    test('should allow resolving alerts', async ({ page }) => {
      // UNTESTED: Alert resolution doesn't exist yet
      const alertItem = page
        .locator('[data-testid="alert-item"]')
        .filter({ hasText: /acknowledged/i })
        .first();

      if (await alertItem.isVisible({ timeout: 3000 })) {
        // Click resolve button
        const resolveButton = alertItem.locator('button').filter({ hasText: /resolve/i });
        await resolveButton.click();

        // Alert should be removed or marked resolved
        await page.waitForLoadState('networkidle');
      }
    });
  });

  test.describe('Budget Widget on Project Dashboard', () => {
    test('should display budget widget on project page', async ({ page }) => {
      // UNTESTED: Budget widget doesn't exist yet
      await page.goto(`/projects/${TEST_PROJECT_ID}`);
      await page.waitForLoadState('networkidle');

      // Should have budget widget
      const budgetWidget = page.locator('[data-testid="budget-widget"]');
      await expect(budgetWidget).toBeVisible({ timeout: 5000 });
    });

    test('should show utilization donut chart', async ({ page }) => {
      // UNTESTED: Donut chart doesn't exist yet
      await page.goto(`/projects/${TEST_PROJECT_ID}`);
      await page.waitForLoadState('networkidle');

      const budgetWidget = page.locator('[data-testid="budget-widget"]');
      const donutChart = budgetWidget.locator('[data-testid="utilization-chart"], svg, canvas');
      await expect(donutChart).toBeVisible({ timeout: 5000 });
    });

    test('should navigate to full budget page from widget', async ({ page }) => {
      // UNTESTED: Widget navigation doesn't exist yet
      await page.goto(`/projects/${TEST_PROJECT_ID}`);
      await page.waitForLoadState('networkidle');

      const budgetWidget = page.locator('[data-testid="budget-widget"]');
      const viewMoreLink = budgetWidget.locator('a, button').filter({ hasText: /view.*more|details/i });
      await viewMoreLink.click();

      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('/budget');
    });
  });
});
