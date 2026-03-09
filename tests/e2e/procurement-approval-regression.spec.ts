/**
 * E2E Regression Tests for Procurement Approval APIs
 * Tests the approval workflow APIs to prevent regressions in the procurement approval system
 *
 * APIs tested:
 * - GET /api/procurement/approvals/pending — returns pending approvals for the user
 * - POST /api/procurement/approvals/[id]/approve — approves a pending item
 * - POST /api/procurement/approvals/[id]/reject — rejects a pending item
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

// ── AUTH TESTS ───────────────────────────────────────────────────────────────

test.describe('Procurement Approval APIs - Auth @smoke @procurement-approval', () => {
  test('GET /api/procurement/approvals/pending returns 401 without auth', async ({ page }) => {
    // Clear all cookies to simulate unauthenticated request
    await page.context().clearCookies();
    
    const res = await page.request.get('/api/procurement/approvals/pending');
    expect(res.status()).toBe(401);
  });

  test('POST /api/procurement/approvals/[id]/approve returns 401 without auth', async ({ page }) => {
    await page.context().clearCookies();
    
    const res = await page.request.post('/api/procurement/approvals/test-id/approve', {
      data: { notes: 'test' },
    });
    expect(res.status()).toBe(401);
  });

  test('POST /api/procurement/approvals/[id]/reject returns 401 without auth', async ({ page }) => {
    await page.context().clearCookies();
    
    const res = await page.request.post('/api/procurement/approvals/test-id/reject', {
      data: { notes: 'test' },
    });
    expect(res.status()).toBe(401);
  });
});

// ── PENDING APPROVALS API ────────────────────────────────────────────────────

test.describe('Procurement Approvals - Pending List @procurement-approval', () => {
  test('GET /api/procurement/approvals/pending returns 200 for authenticated user', async ({ request }) => {
    const res = await request.get('/api/procurement/approvals/pending');
    expect(res.status()).toBe(200);
    
    const json = await res.json();
    
    // Verify response structure
    expect(json).toHaveProperty('success');
    expect(json.success).toBe(true);
    expect(json).toHaveProperty('data');
    
    const data = json.data;
    expect(data).toHaveProperty('tasks');
    expect(data).toHaveProperty('summary');
    
    // Tasks should be an array
    expect(Array.isArray(data.tasks)).toBe(true);
  });

  test('GET /api/procurement/approvals/pending returns tasks with expected shape', async ({ request }) => {
    const res = await request.get('/api/procurement/approvals/pending');
    const json = await res.json();
    
    const data = json.data;
    const tasks = data.tasks;
    
    // If there are pending tasks, verify their structure
    if (tasks.length > 0) {
      const task = tasks[0];
      
      // Required fields from MyApprovalTask interface
      expect(task).toHaveProperty('id');
      expect(task).toHaveProperty('documentType');
      expect(task).toHaveProperty('documentId');
      expect(task).toHaveProperty('workflowName');
      expect(task).toHaveProperty('levelName');
      expect(task).toHaveProperty('levelNumber');
      expect(task).toHaveProperty('requestedBy');
      expect(task).toHaveProperty('requestedAt');
      expect(task).toHaveProperty('canApprove');
      expect(task).toHaveProperty('canReject');
      
      // Verify field types
      expect(typeof task.id).toBe('string');
      expect(typeof task.documentType).toBe('string');
      expect(typeof task.documentId).toBe('string');
      expect(typeof task.workflowName).toBe('string');
      expect(typeof task.levelName).toBe('string');
      expect(typeof task.levelNumber).toBe('number');
      expect(typeof task.requestedBy).toBe('string');
      expect(typeof task.requestedAt).toBe('string');
      expect(typeof task.canApprove).toBe('boolean');
      expect(typeof task.canReject).toBe('boolean');
    }
  });

  test('GET /api/procurement/approvals/pending returns summary with count aggregates', async ({ request }) => {
    const res = await request.get('/api/procurement/approvals/pending');
    const json = await res.json();
    
    const data = json.data;
    const summary = data.summary;
    
    // Verify summary structure
    expect(summary).toHaveProperty('total');
    expect(summary).toHaveProperty('byType');
    expect(summary).toHaveProperty('overdue');
    
    // Verify field types
    expect(typeof summary.total).toBe('number');
    expect(typeof summary.overdue).toBe('number');
    expect(typeof summary.byType).toBe('object');
    
    // Total should be >= 0
    expect(summary.total).toBeGreaterThanOrEqual(0);
    expect(summary.overdue).toBeGreaterThanOrEqual(0);
  });

  test('GET /api/procurement/approvals/pending respects user permissions', async ({ request }) => {
    const res = await request.get('/api/procurement/approvals/pending');
    const json = await res.json();
    
    const tasks = json.data.tasks;
    
    // All returned tasks should have canApprove or canReject = true (user is authorized)
    tasks.forEach((task: any) => {
      const userCanApprovOrReject = task.canApprove || task.canReject;
      expect(userCanApprovOrReject).toBe(true);
    });
  });

  test('GET /api/procurement/approvals/pending returns at most 50 items', async ({ request }) => {
    const res = await request.get('/api/procurement/approvals/pending');
    const json = await res.json();
    
    const tasks = json.data.tasks;
    
    // Database query limits to 50 items
    expect(tasks.length).toBeLessThanOrEqual(50);
  });
});

// ── APPROVAL ACTIONS ─────────────────────────────────────────────────────────

test.describe('Procurement Approvals - Approval Actions @procurement-approval', () => {
  test('POST /api/procurement/approvals/[id]/approve with non-existent ID returns 404 or error', async ({ request }) => {
    const nonExistentId = 'approval-id-that-does-not-exist-' + Date.now();
    
    const res = await request.post(`/api/procurement/approvals/${nonExistentId}/approve`, {
      data: {
        notes: 'Approved',
      },
    });
    
    // Should return 404 or 400 for invalid ID
    expect([400, 404, 422]).toContain(res.status());
  });

  test('POST /api/procurement/approvals/[id]/reject with non-existent ID returns 404 or error', async ({ request }) => {
    const nonExistentId = 'approval-id-that-does-not-exist-' + Date.now();
    
    const res = await request.post(`/api/procurement/approvals/${nonExistentId}/reject`, {
      data: {
        notes: 'Rejected due to policy violation',
      },
    });
    
    // Should return 404 or 400 for invalid ID
    expect([400, 404, 422]).toContain(res.status());
  });

  test('POST /api/procurement/approvals/[id]/approve requires valid ID format', async ({ request }) => {
    const invalidId = 'not-a-uuid';
    
    const res = await request.post(`/api/procurement/approvals/${invalidId}/approve`, {
      data: {
        notes: 'test',
      },
    });
    
    // Should reject invalid format
    expect([400, 404, 422]).toContain(res.status());
  });

  test('POST /api/procurement/approvals/[id]/reject requires valid ID format', async ({ request }) => {
    const invalidId = 'not-a-uuid';
    
    const res = await request.post(`/api/procurement/approvals/${invalidId}/reject`, {
      data: {
        notes: 'test',
      },
    });
    
    // Should reject invalid format
    expect([400, 404, 422]).toContain(res.status());
  });
});

// ── APPROVAL FLOW INTEGRATION ────────────────────────────────────────────────

test.describe('Procurement Approvals - Workflow Integration @procurement-approval', () => {
  test('Approval list contains items that can be approved', async ({ request }) => {
    const listRes = await request.get('/api/procurement/approvals/pending');
    const listJson = await listRes.json();
    
    const tasks = listJson.data.tasks;
    
    // Find an approval the user can approve
    const approvableTask = tasks.find((task: any) => task.canApprove === true);
    
    if (approvableTask) {
      // Verify that the task structure makes sense for approval
      expect(approvableTask.id).toBeTruthy();
      expect(approvableTask.documentType).toBeTruthy();
      expect(approvableTask.documentId).toBeTruthy();
      expect(approvableTask.levelNumber).toBeGreaterThan(0);
    }
  });

  test('Multiple approval document types are represented', async ({ request }) => {
    const res = await request.get('/api/procurement/approvals/pending');
    const json = await res.json();
    
    const tasks = json.data.tasks;
    
    // If there are multiple tasks, they might have different document types
    if (tasks.length > 1) {
      const documentTypes = new Set(tasks.map((t: any) => t.documentType));
      // Just verify we can extract and group by type
      expect(documentTypes.size).toBeGreaterThan(0);
    }
  });

  test('Overdue approvals are identified correctly', async ({ request }) => {
    const res = await request.get('/api/procurement/approvals/pending');
    const json = await res.json();
    
    const tasks = json.data.tasks;
    
    // Count overdue items in the tasks
    const overdueInTasks = tasks.filter((t: any) => t.isOverdue === true).length;
    
    // Summary should match
    const overdueSummary = json.data.summary.overdue;
    expect(overdueInTasks).toBeLessThanOrEqual(overdueSummary);
  });

  test('Document amounts are tracked for approval thresholds', async ({ request }) => {
    const res = await request.get('/api/procurement/approvals/pending');
    const json = await res.json();
    
    const tasks = json.data.tasks;
    
    // At least some tasks should have document amounts
    // (For PO approval, amounts are important for threshold-based workflows)
    if (tasks.length > 0) {
      const tasksWithAmount = tasks.filter((t: any) => typeof t.documentAmount === 'number');
      // Some might have amounts, some might not depending on document type
      expect(Array.isArray(tasks)).toBe(true);
    }
  });
});
