/**
 * Assets Module Integration Tests
 *
 * Real integration tests against the database.
 * Run with: npm test -- --run src/modules/assets/__tests__/integration.test.ts
 *
 * Uses DATABASE_URL from .env.local (loaded by vitest)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assetService } from '../services/assetService';
import { categoryService } from '../services/categoryService';
import { assignmentService } from '../services/assignmentService';
import { maintenanceService } from '../services/maintenanceService';
import { resetDbConnection, getDbConnection } from '../utils/db';

// Track created resources for cleanup
const createdAssetIds: string[] = [];
const createdCategoryIds: string[] = [];

// Skip all tests if no DATABASE_URL
const skipTests = !process.env.DATABASE_URL;

describe.skipIf(skipTests)('Assets Module Integration Tests', () => {
  beforeAll(async () => {
    // Reset and validate DB connection
    resetDbConnection();
    const sql = getDbConnection();
    // Quick connection test
    const result = await sql`SELECT 1 as test`;
    if (!result || result.length === 0) {
      throw new Error('Database connection failed');
    }
  });

  afterAll(async () => {
    // Cleanup created test data
    for (const id of createdAssetIds) {
      try {
        await assetService.delete(id);
      } catch {
        // Ignore cleanup errors
      }
    }
    for (const id of createdCategoryIds) {
      try {
        await categoryService.delete(id);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Category Service', () => {
    it('should list all categories', async () => {
      const result = await categoryService.getAll();

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
    });

    it('should get category by ID', async () => {
      // First get a category
      const listResult = await categoryService.getAll();
      expect(listResult.success).toBe(true);
      expect(listResult.data.length).toBeGreaterThan(0);

      const categoryId = listResult.data[0].id;
      const result = await categoryService.getById(categoryId);

      expect(result.success).toBe(true);
      expect(result.data).not.toBeNull();
      expect(result.data?.id).toBe(categoryId);
    });

    it('should filter active categories', async () => {
      const result = await categoryService.getAll({ isActive: true });

      expect(result.success).toBe(true);
      expect(result.data.every(c => c.isActive)).toBe(true);
    });
  });

  describe('Asset Service CRUD', () => {
    let testCategoryId: string;
    let testAssetId: string;

    beforeAll(async () => {
      // Get a category for testing
      const catResult = await categoryService.getAll({ isActive: true });
      expect(catResult.success).toBe(true);
      expect(catResult.data.length).toBeGreaterThan(0);
      testCategoryId = catResult.data[0].id;
    });

    it('should create an asset', async () => {
      const result = await assetService.create(
        {
          categoryId: testCategoryId,
          name: 'Integration Test Asset',
          serialNumber: `INT-TEST-${Date.now()}`,
          manufacturer: 'Test Manufacturer',
          model: 'Test Model',
        },
        'integration-test'
      );

      expect(result.success).toBe(true);
      expect(result.data).not.toBeNull();
      expect(result.data?.name).toBe('Integration Test Asset');
      expect(result.data?.assetNumber).toBeDefined();
      expect(result.data?.status).toBe('available');

      testAssetId = result.data!.id;
      createdAssetIds.push(testAssetId);
    });

    it('should list assets', async () => {
      const result = await assetService.getAll();

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.pagination).toBeDefined();
    });

    it('should get asset by ID', async () => {
      const result = await assetService.getById(testAssetId);

      expect(result.success).toBe(true);
      expect(result.data).not.toBeNull();
      expect(result.data?.id).toBe(testAssetId);
    });

    it('should update an asset', async () => {
      const result = await assetService.update(
        testAssetId,
        {
          name: 'Updated Integration Test Asset',
          condition: 'good',
          notes: 'Updated via integration test',
        },
        'integration-test'
      );

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Updated Integration Test Asset');
      expect(result.data?.condition).toBe('good');
    });

    it('should search assets', async () => {
      const result = await assetService.search('Integration Test');

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should get dashboard stats', async () => {
      const result = await assetService.getDashboardStats();

      expect(result.success).toBe(true);
      expect(result.data).not.toBeNull();
      expect(typeof result.data?.totalAssets).toBe('number');
      expect(typeof result.data?.availableAssets).toBe('number');
    });

    it('should delete an asset', async () => {
      const result = await assetService.delete(testAssetId);

      expect(result.success).toBe(true);
      expect(result.data).toBe(true);

      // Remove from cleanup list since already deleted
      const idx = createdAssetIds.indexOf(testAssetId);
      if (idx > -1) createdAssetIds.splice(idx, 1);

      // Verify deletion
      const verifyResult = await assetService.getById(testAssetId);
      expect(verifyResult.data).toBeNull();
    });
  });

  describe('Assignment Service (Checkout/Checkin)', () => {
    let testCategoryId: string;
    let testAssetId: string;
    let assignmentId: string;

    beforeAll(async () => {
      // Get a category
      const catResult = await categoryService.getAll({ isActive: true });
      testCategoryId = catResult.data[0].id;

      // Create an asset for checkout testing
      const assetResult = await assetService.create(
        {
          categoryId: testCategoryId,
          name: 'Checkout Test Asset',
          serialNumber: `CHECKOUT-${Date.now()}`,
        },
        'integration-test'
      );
      testAssetId = assetResult.data!.id;
      createdAssetIds.push(testAssetId);
    });

    it('should checkout an asset', async () => {
      const result = await assignmentService.checkout(
        {
          assetId: testAssetId,
          toType: 'staff',
          toId: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
          toName: 'Test User',
          conditionAtCheckout: 'good',
          purpose: 'Integration test',
        },
        'integration-test'
      );

      expect(result.success).toBe(true);
      expect(result.data).not.toBeNull();
      expect(result.data?.assignmentType).toBe('checkout');
      expect(result.data?.isActive).toBe(true);

      assignmentId = result.data!.id;

      // Verify asset status changed
      const assetResult = await assetService.getById(testAssetId);
      expect(assetResult.data?.status).toBe('assigned');
    });

    it('should not checkout an already assigned asset', async () => {
      const result = await assignmentService.checkout(
        {
          assetId: testAssetId,
          toType: 'staff',
          toId: 'b2c3d4e5-f6a7-4901-bcde-f12345678901',
          toName: 'Another User',
          conditionAtCheckout: 'good',
        },
        'integration-test'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
    });

    it('should get active assignment', async () => {
      const result = await assignmentService.getActiveAssignment(testAssetId);

      expect(result.success).toBe(true);
      expect(result.data).not.toBeNull();
      expect(result.data?.isActive).toBe(true);
    });

    it('should checkin an asset', async () => {
      const result = await assignmentService.checkin(
        {
          assignmentId: assignmentId,
          conditionAtCheckin: 'good',
          checkinNotes: 'Returned via integration test',
        },
        'integration-test'
      );

      expect(result.success).toBe(true);
      expect(result.data?.isActive).toBe(false);
      expect(result.data?.checkedInAt).toBeDefined();

      // Verify asset status changed back
      const assetResult = await assetService.getById(testAssetId);
      expect(assetResult.data?.status).toBe('available');
    });

    it('should get assignment history', async () => {
      const result = await assignmentService.getHistory(testAssetId);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
    });
  });

  describe('Maintenance Service', () => {
    let testCategoryId: string;
    let testAssetId: string;
    let maintenanceId: string;

    beforeAll(async () => {
      // Get a category that requires calibration
      const catResult = await categoryService.getAll({ isActive: true });
      const calibrationCategory = catResult.data.find(c => c.requiresCalibration);
      testCategoryId = calibrationCategory?.id || catResult.data[0].id;

      // Create an asset for maintenance testing
      const assetResult = await assetService.create(
        {
          categoryId: testCategoryId,
          name: 'Maintenance Test Asset',
          serialNumber: `MAINT-${Date.now()}`,
        },
        'integration-test'
      );
      testAssetId = assetResult.data!.id;
      createdAssetIds.push(testAssetId);
    });

    it('should schedule maintenance', async () => {
      const scheduledDate = new Date();
      scheduledDate.setDate(scheduledDate.getDate() + 7);

      const result = await maintenanceService.schedule(
        {
          assetId: testAssetId,
          maintenanceType: 'preventive',
          scheduledDate: scheduledDate.toISOString().split('T')[0],
          description: 'Integration test maintenance',
        },
        'integration-test'
      );

      expect(result.success).toBe(true);
      expect(result.data).not.toBeNull();
      expect(result.data?.maintenanceType).toBe('preventive');
      expect(result.data?.status).toBe('scheduled');

      maintenanceId = result.data!.id;
    });

    it('should get maintenance by ID', async () => {
      const result = await maintenanceService.getById(maintenanceId);

      expect(result.success).toBe(true);
      expect(result.data).not.toBeNull();
      expect(result.data?.id).toBe(maintenanceId);
    });

    it('should get maintenance by asset', async () => {
      const result = await maintenanceService.getByAsset(testAssetId);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
    });

    it('should complete maintenance', async () => {
      const result = await maintenanceService.complete(
        {
          maintenanceId: maintenanceId,
          completedDate: new Date().toISOString().split('T')[0],
          workPerformed: 'Completed integration test maintenance',
          conditionAfter: 'excellent',
        },
        'integration-test'
      );

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('completed');
      expect(result.data?.completedDate).toBeDefined();
    });

    it('should get dashboard stats', async () => {
      const result = await maintenanceService.getDashboardStats();

      expect(result.success).toBe(true);
      expect(result.data).not.toBeNull();
      expect(typeof result.data?.totalScheduled).toBe('number');
    });
  });
});
