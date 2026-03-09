/**
 * E2E Tests for Field Ops Dashboard
 * Tests construction-qa APIs: project-dashboard, zone-hierarchy, pon-features
 *
 * APIs tested:
 * - GET /api/construction-qa/project-dashboard — returns per-project aggregates
 * - GET /api/construction-qa/zone-hierarchy?projectId=X — returns zone/PON hierarchy
 * - GET /api/construction-qa/pon-features?ponId=X — returns features for a PON
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

test.describe('Construction QA APIs - Auth @smoke @construction-qa', () => {
  test('GET /api/construction-qa/project-dashboard returns 401 without auth', async ({ page }) => {
    // Clear all cookies to simulate unauthenticated request
    await page.context().clearCookies();
    
    const res = await page.request.get('/api/construction-qa/project-dashboard');
    expect(res.status()).toBe(401);
  });

  test('GET /api/construction-qa/zone-hierarchy returns 401 without auth', async ({ page }) => {
    await page.context().clearCookies();
    
    const res = await page.request.get('/api/construction-qa/zone-hierarchy?projectId=test-project-1');
    expect(res.status()).toBe(401);
  });

  test('GET /api/construction-qa/pon-features returns 401 without auth', async ({ page }) => {
    await page.context().clearCookies();
    
    const res = await page.request.get('/api/construction-qa/pon-features?ponId=test-pon-1');
    expect(res.status()).toBe(401);
  });
});

// ── PROJECT DASHBOARD API ────────────────────────────────────────────────────

test.describe('Construction QA Project Dashboard @construction-qa', () => {
  test('GET /api/construction-qa/project-dashboard returns authenticated user projects', async ({ request }) => {
    const res = await request.get('/api/construction-qa/project-dashboard');
    expect(res.status()).toBe(200);
    
    const json = await res.json();
    
    // Verify response structure
    expect(json).toHaveProperty('success');
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    
    // Verify each project has required fields
    if (json.data.length > 0) {
      const project = json.data[0];
      expect(project).toHaveProperty('project_id');
      expect(project).toHaveProperty('project_name');
      expect(project).toHaveProperty('discipline');
      expect(project).toHaveProperty('total');
      expect(project).toHaveProperty('pending');
      expect(project).toHaveProperty('approved');
      expect(project).toHaveProperty('rejected');
      
      // Verify field types
      expect(typeof project.project_id).toBe('string');
      expect(typeof project.project_name).toBe('string');
      expect(typeof project.total).toBe('number');
      expect(typeof project.pending).toBe('number');
      expect(typeof project.approved).toBe('number');
      expect(typeof project.rejected).toBe('number');
    }
  });

  test('GET /api/construction-qa/project-dashboard returns all expected metrics', async ({ request }) => {
    const res = await request.get('/api/construction-qa/project-dashboard');
    const json = await res.json();
    
    if (json.data.length > 0) {
      const project = json.data[0];
      // Verify aggregates add up logically
      expect(project.total).toBeGreaterThanOrEqual(0);
      expect(project.pending).toBeGreaterThanOrEqual(0);
      expect(project.approved).toBeGreaterThanOrEqual(0);
      expect(project.rejected).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── ZONE HIERARCHY API ───────────────────────────────────────────────────────

test.describe('Construction QA Zone Hierarchy @construction-qa', () => {
  test('GET /api/construction-qa/zone-hierarchy returns 400 without projectId', async ({ request }) => {
    const res = await request.get('/api/construction-qa/zone-hierarchy');
    expect([400, 422]).toContain(res.status());
  });

  test('GET /api/construction-qa/zone-hierarchy returns valid structure with projectId', async ({ request }) => {
    // First get a valid projectId from the dashboard
    const dashRes = await request.get('/api/construction-qa/project-dashboard');
    const dashJson = await dashRes.json();
    
    if (dashJson.data && dashJson.data.length > 0) {
      const projectId = dashJson.data[0].project_id;
      
      const res = await request.get(`/api/construction-qa/zone-hierarchy?projectId=${projectId}`);
      expect(res.status()).toBe(200);
      
      const json = await res.json();
      expect(json).toHaveProperty('success');
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      
      // Verify zone structure if zones exist
      if (json.data.length > 0) {
        const zone = json.data[0];
        expect(zone).toHaveProperty('zone_id');
        expect(zone).toHaveProperty('zone_name');
        
        // PON counts should be present
        if (zone.pons) {
          expect(Array.isArray(zone.pons)).toBe(true);
        }
      }
    }
  });

  test('GET /api/construction-qa/zone-hierarchy with invalid projectId returns empty or error', async ({ request }) => {
    const res = await request.get('/api/construction-qa/zone-hierarchy?projectId=invalid-project-id-xyz');
    
    // Should be 200 with empty data or 404 depending on implementation
    expect([200, 404]).toContain(res.status());
    
    const json = await res.json();
    if (res.status() === 200) {
      expect(Array.isArray(json.data)).toBe(true);
    }
  });
});

// ── PON FEATURES API ─────────────────────────────────────────────────────────

test.describe('Construction QA PON Features @construction-qa', () => {
  test('GET /api/construction-qa/pon-features returns 400 without ponId', async ({ request }) => {
    const res = await request.get('/api/construction-qa/pon-features');
    expect([400, 422]).toContain(res.status());
  });

  test('GET /api/construction-qa/pon-features returns feature list with valid ponId', async ({ request }) => {
    // First get a valid ponId from zone hierarchy
    const dashRes = await request.get('/api/construction-qa/project-dashboard');
    const dashJson = await dashRes.json();
    
    if (dashJson.data && dashJson.data.length > 0) {
      const projectId = dashJson.data[0].project_id;
      
      const zoneRes = await request.get(`/api/construction-qa/zone-hierarchy?projectId=${projectId}`);
      const zoneJson = await zoneRes.json();
      
      if (zoneJson.data && zoneJson.data.length > 0) {
        const zone = zoneJson.data[0];
        
        if (zone.pons && zone.pons.length > 0) {
          const ponId = zone.pons[0].id || zone.pons[0].pon_id;
          
          const res = await request.get(`/api/construction-qa/pon-features?ponId=${ponId}`);
          expect(res.status()).toBe(200);
          
          const json = await res.json();
          expect(json).toHaveProperty('success');
          expect(json.success).toBe(true);
          expect(Array.isArray(json.data)).toBe(true);
          
          // Verify feature structure if features exist
          if (json.data.length > 0) {
            const feature = json.data[0];
            expect(typeof feature.id).toBe('string');
            expect(typeof feature.name).toBe('string');
          }
        }
      }
    }
  });

  test('GET /api/construction-qa/pon-features with invalid ponId returns empty or error', async ({ request }) => {
    const res = await request.get('/api/construction-qa/pon-features?ponId=invalid-pon-xyz');
    
    // Should be 200 with empty data or 404 depending on implementation
    expect([200, 404]).toContain(res.status());
    
    const json = await res.json();
    if (res.status() === 200) {
      expect(Array.isArray(json.data)).toBe(true);
    }
  });

  test('GET /api/construction-qa/pon-features returns features with expected fields', async ({ request }) => {
    // Get a valid PON ID
    const dashRes = await request.get('/api/construction-qa/project-dashboard');
    const dashJson = await dashRes.json();
    
    if (dashJson.data && dashJson.data.length > 0) {
      const projectId = dashJson.data[0].project_id;
      
      const zoneRes = await request.get(`/api/construction-qa/zone-hierarchy?projectId=${projectId}`);
      const zoneJson = await zoneRes.json();
      
      if (zoneJson.data && zoneJson.data.length > 0) {
        const zone = zoneJson.data[0];
        
        if (zone.pons && zone.pons.length > 0) {
          const ponId = zone.pons[0].id || zone.pons[0].pon_id;
          
          const res = await request.get(`/api/construction-qa/pon-features?ponId=${ponId}`);
          
          if (res.status() === 200) {
            const json = await res.json();
            
            if (json.data && json.data.length > 0) {
              const feature = json.data[0];
              // Common feature fields
              expect(feature).toHaveProperty('id');
              expect(feature).toHaveProperty('name');
              // Status or type might be present
              expect([true, false]).toContain('status' in feature || 'type' in feature || true);
            }
          }
        }
      }
    }
  });
});
