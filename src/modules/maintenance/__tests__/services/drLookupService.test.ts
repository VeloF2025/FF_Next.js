/**
 * DR Lookup Service Tests (TDD)
 *
 * Tests FIRST - Implementation SECOND
 *
 * Testing DR number lookup from SOW module:
 * - Lookup valid DR number
 * - Lookup invalid DR number
 * - Lookup DR - returns project info
 * - Lookup DR - returns zone info
 * - Lookup DR - caching works
 * - Lookup DR - error handling
 *
 * 🟢 WORKING: Comprehensive test suite for DR lookup service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  lookupDR,
  clearDRCache,
  getDRFromCache
} from '../../services/drLookupService';
import { DRLookupResult } from '../../types/ticket';

// Mock the database utility
vi.mock('../../utils/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn()
}));

// Mock the logger
vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }))
}));

import { query, queryOne } from '../../utils/db';

describe('DR Lookup Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear cache before each test
    clearDRCache();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('lookupDR - Valid DR Number', () => {
    it('should lookup a valid DR number and return complete details', async () => {
      // 🟢 WORKING: Test DR lookup with all fields populated
      const drNumber = 'DR-2024-001';
      const mockDRData = {
        drop_number: 'DR-2024-001',
        pole_number: 'POLE-123',
        project_id: 'proj-uuid-123',
        pon_no: 5,
        zone_no: 2,
        address: '123 Main Street, Cape Town',
        latitude: -33.9249,
        longitude: 18.4241,
        municipality: 'Cape Town',
        cable_type: 'Fiber',
        cable_length: '50m',
        status: 'installed',
        created_date: new Date('2024-01-01'),
        created_by: 'installer-123'
      };

      const mockProjectData = {
        id: 'proj-uuid-123',
        name: 'Cape Town Fiber Rollout 2024',
        code: 'CT-2024',
        status: 'active'
      };

      // Mock database responses
      vi.mocked(queryOne).mockResolvedValueOnce(mockDRData); // DR lookup
      vi.mocked(queryOne).mockResolvedValueOnce(mockProjectData); // Project lookup

      const result = await lookupDR(drNumber);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.dr_number).toBe(drNumber);
      expect(result.data?.pole_number).toBe('POLE-123');
      expect(result.data?.pon_number).toBe(5);
      expect(result.data?.zone_number).toBe(2);
      expect(result.data?.project_id).toBe('proj-uuid-123');
      expect(result.data?.project_name).toBe('Cape Town Fiber Rollout 2024');
      expect(result.data?.address).toBe('123 Main Street, Cape Town');

      // Verify database was queried
      expect(queryOne).toHaveBeenCalledTimes(2);
      expect(queryOne).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('SELECT'),
        expect.arrayContaining([drNumber])
      );
    });

    it('should lookup DR with minimal fields (pole, PON, zone can be null)', async () => {
      // 🟢 WORKING: Test DR lookup with only required fields
      const drNumber = 'DR-2024-002';
      const mockDRData = {
        drop_number: 'DR-2024-002',
        pole_number: null,
        project_id: 'proj-uuid-456',
        pon_no: null,
        zone_no: null,
        address: null,
        latitude: null,
        longitude: null,
        municipality: null,
        cable_type: null,
        cable_length: null,
        status: 'planned',
        created_date: null,
        created_by: null
      };

      const mockProjectData = {
        id: 'proj-uuid-456',
        name: 'Johannesburg Project',
        code: 'JHB-2024',
        status: 'active'
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockDRData);
      vi.mocked(queryOne).mockResolvedValueOnce(mockProjectData);

      const result = await lookupDR(drNumber);

      expect(result.success).toBe(true);
      expect(result.data?.dr_number).toBe(drNumber);
      expect(result.data?.pole_number).toBeNull();
      expect(result.data?.pon_number).toBeNull();
      expect(result.data?.zone_number).toBeNull();
      expect(result.data?.project_id).toBe('proj-uuid-456');
    });
  });

  describe('lookupDR - Invalid DR Number', () => {
    it('should return error when DR number does not exist', async () => {
      // 🟢 WORKING: Test handling of non-existent DR number
      const drNumber = 'DR-9999-999';

      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const result = await lookupDR(drNumber);

      expect(result.success).toBe(false);
      expect(result.error).toBe('DR number not found');
      expect(result.data).toBeNull();

      // Should only query drops table, not project
      expect(queryOne).toHaveBeenCalledTimes(1);
    });

    it('should return error for empty DR number', async () => {
      // 🟢 WORKING: Test validation of empty DR number
      const result = await lookupDR('');

      expect(result.success).toBe(false);
      expect(result.error).toBe('DR number is required');
      expect(result.data).toBeNull();

      // Should not query database
      expect(queryOne).not.toHaveBeenCalled();
    });

    it('should return error for whitespace-only DR number', async () => {
      // 🟢 WORKING: Test validation of whitespace DR number
      const result = await lookupDR('   ');

      expect(result.success).toBe(false);
      expect(result.error).toBe('DR number is required');
      expect(result.data).toBeNull();

      expect(queryOne).not.toHaveBeenCalled();
    });
  });

  describe('lookupDR - Returns Project Info', () => {
    it('should include full project details in result', async () => {
      // 🟢 WORKING: Test that project information is included
      const drNumber = 'DR-2024-003';
      const mockDRData = {
        drop_number: drNumber,
        pole_number: 'POLE-456',
        project_id: 'proj-uuid-789',
        pon_no: 3,
        zone_no: 1,
        address: '456 Oak Avenue',
        latitude: -33.9249,
        longitude: 18.4241,
        municipality: 'Cape Town',
        cable_type: 'Fiber',
        cable_length: '100m',
        status: 'active',
        created_date: new Date(),
        created_by: 'user-1'
      };

      const mockProjectData = {
        id: 'proj-uuid-789',
        name: 'Western Cape Network Expansion',
        code: 'WC-EXP-2024',
        status: 'active',
        start_date: new Date('2024-01-01'),
        end_date: new Date('2024-12-31'),
        location: {
          city: 'Cape Town',
          province: 'Western Cape'
        }
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockDRData);
      vi.mocked(queryOne).mockResolvedValueOnce(mockProjectData);

      const result = await lookupDR(drNumber);

      expect(result.success).toBe(true);
      expect(result.data?.project_id).toBe('proj-uuid-789');
      expect(result.data?.project_name).toBe('Western Cape Network Expansion');
      expect(result.data?.project_code).toBe('WC-EXP-2024');
    });

    it('should handle DR without project (orphaned DR)', async () => {
      // 🟢 WORKING: Test handling of DR with invalid project_id
      const drNumber = 'DR-2024-004';
      const mockDRData = {
        drop_number: drNumber,
        pole_number: 'POLE-789',
        project_id: 'invalid-project-id',
        pon_no: 4,
        zone_no: 3,
        address: '789 Elm Street',
        latitude: null,
        longitude: null,
        municipality: null,
        cable_type: null,
        cable_length: null,
        status: 'planned',
        created_date: null,
        created_by: null
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockDRData);
      vi.mocked(queryOne).mockResolvedValueOnce(null); // Project not found

      const result = await lookupDR(drNumber);

      expect(result.success).toBe(true);
      expect(result.data?.dr_number).toBe(drNumber);
      expect(result.data?.project_id).toBe('invalid-project-id');
      expect(result.data?.project_name).toBeNull();
      expect(result.data?.project_code).toBeNull();
    });
  });

  describe('lookupDR - Returns Zone Info', () => {
    it('should return zone and PON numbers when available', async () => {
      // 🟢 WORKING: Test zone and PON data extraction
      const drNumber = 'DR-2024-005';
      const mockDRData = {
        drop_number: drNumber,
        pole_number: 'POLE-999',
        project_id: 'proj-uuid-111',
        pon_no: 12,
        zone_no: 7,
        address: '999 Pine Road',
        latitude: -33.9249,
        longitude: 18.4241,
        municipality: 'Stellenbosch',
        cable_type: 'Fiber',
        cable_length: '75m',
        status: 'installed',
        created_date: new Date(),
        created_by: 'user-2'
      };

      const mockProjectData = {
        id: 'proj-uuid-111',
        name: 'Stellenbosch Fiber Project',
        code: 'SB-2024',
        status: 'active'
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockDRData);
      vi.mocked(queryOne).mockResolvedValueOnce(mockProjectData);

      const result = await lookupDR(drNumber);

      expect(result.success).toBe(true);
      expect(result.data?.zone_number).toBe(7);
      expect(result.data?.pon_number).toBe(12);
    });
  });

  describe('lookupDR - Caching', () => {
    it('should cache DR lookup results to reduce database queries', async () => {
      // 🟢 WORKING: Test that second lookup uses cache
      const drNumber = 'DR-2024-006';
      const mockDRData = {
        drop_number: drNumber,
        pole_number: 'POLE-CACHE',
        project_id: 'proj-cache-123',
        pon_no: 8,
        zone_no: 4,
        address: 'Cache Street',
        latitude: null,
        longitude: null,
        municipality: null,
        cable_type: null,
        cable_length: null,
        status: 'active',
        created_date: null,
        created_by: null
      };

      const mockProjectData = {
        id: 'proj-cache-123',
        name: 'Cache Test Project',
        code: 'CACHE-2024',
        status: 'active'
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockDRData);
      vi.mocked(queryOne).mockResolvedValueOnce(mockProjectData);

      // First lookup - should hit database
      const result1 = await lookupDR(drNumber);
      expect(result1.success).toBe(true);
      expect(queryOne).toHaveBeenCalledTimes(2);

      vi.clearAllMocks();

      // Second lookup - should use cache
      const result2 = await lookupDR(drNumber);
      expect(result2.success).toBe(true);
      expect(result2.data?.dr_number).toBe(drNumber);
      expect(result2.data?.pole_number).toBe('POLE-CACHE');
      expect(queryOne).not.toHaveBeenCalled(); // No DB query
    });

    it('should allow manual cache clearing', async () => {
      // 🟢 WORKING: Test cache clearing functionality
      const drNumber = 'DR-2024-007';
      const mockDRData = {
        drop_number: drNumber,
        pole_number: 'POLE-CLEAR',
        project_id: 'proj-clear-123',
        pon_no: 9,
        zone_no: 5,
        address: 'Clear Street',
        latitude: null,
        longitude: null,
        municipality: null,
        cable_type: null,
        cable_length: null,
        status: 'active',
        created_date: null,
        created_by: null
      };

      const mockProjectData = {
        id: 'proj-clear-123',
        name: 'Clear Cache Project',
        code: 'CLEAR-2024',
        status: 'active'
      };

      vi.mocked(queryOne).mockResolvedValue(mockDRData);
      vi.mocked(queryOne).mockResolvedValueOnce(mockDRData);
      vi.mocked(queryOne).mockResolvedValueOnce(mockProjectData);

      // First lookup
      await lookupDR(drNumber);
      expect(queryOne).toHaveBeenCalledTimes(2);

      vi.clearAllMocks();

      // Verify it's cached
      await lookupDR(drNumber);
      expect(queryOne).not.toHaveBeenCalled();

      // Clear cache
      clearDRCache();

      // Next lookup should hit database again
      vi.mocked(queryOne).mockResolvedValueOnce(mockDRData);
      vi.mocked(queryOne).mockResolvedValueOnce(mockProjectData);
      await lookupDR(drNumber);
      expect(queryOne).toHaveBeenCalledTimes(2);
    });

    it('should provide cache retrieval function', () => {
      // 🟢 WORKING: Test getDRFromCache utility
      const drNumber = 'DR-2024-008';

      // Cache should be empty initially
      const cachedResult1 = getDRFromCache(drNumber);
      expect(cachedResult1).toBeNull();

      // After clearing, should still be null
      clearDRCache();
      const cachedResult2 = getDRFromCache(drNumber);
      expect(cachedResult2).toBeNull();
    });
  });

  describe('lookupDR - Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      // 🟢 WORKING: Test database error handling
      const drNumber = 'DR-2024-009';

      vi.mocked(queryOne).mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const result = await lookupDR(drNumber);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to lookup DR number');
      expect(result.data).toBeNull();
    });

    it('should handle database query timeout', async () => {
      // 🟢 WORKING: Test timeout error handling
      const drNumber = 'DR-2024-010';

      vi.mocked(queryOne).mockRejectedValueOnce(
        new Error('Query timeout exceeded')
      );

      const result = await lookupDR(drNumber);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to lookup DR number');
      expect(result.data).toBeNull();
    });

    it('should handle project lookup failure but still return DR data', async () => {
      // 🟢 WORKING: Test partial success when project lookup fails
      const drNumber = 'DR-2024-011';
      const mockDRData = {
        drop_number: drNumber,
        pole_number: 'POLE-ERROR',
        project_id: 'proj-error-123',
        pon_no: 10,
        zone_no: 6,
        address: 'Error Street',
        latitude: null,
        longitude: null,
        municipality: null,
        cable_type: null,
        cable_length: null,
        status: 'active',
        created_date: null,
        created_by: null
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockDRData);
      vi.mocked(queryOne).mockRejectedValueOnce(
        new Error('Project table not accessible')
      );

      const result = await lookupDR(drNumber);

      // Should still succeed with DR data even if project lookup fails
      expect(result.success).toBe(true);
      expect(result.data?.dr_number).toBe(drNumber);
      expect(result.data?.project_name).toBeNull();
    });

    it('should handle malformed database response', async () => {
      // 🟢 WORKING: Test handling of unexpected data format
      const drNumber = 'DR-2024-012';

      vi.mocked(queryOne).mockResolvedValueOnce({
        // Missing required fields
        some_random_field: 'value'
      } as any);

      const result = await lookupDR(drNumber);

      expect(result.success).toBe(false);
      expect(result.error).toBe('DR number not found');
      expect(result.data).toBeNull();
    });
  });

  describe('lookupDR - Input Validation', () => {
    it('should trim whitespace from DR number', async () => {
      // 🟢 WORKING: Test whitespace trimming
      const drNumber = '  DR-2024-013  ';
      const trimmedDR = 'DR-2024-013';

      const mockDRData = {
        drop_number: trimmedDR,
        pole_number: 'POLE-TRIM',
        project_id: 'proj-trim-123',
        pon_no: 11,
        zone_no: 7,
        address: 'Trim Street',
        latitude: null,
        longitude: null,
        municipality: null,
        cable_type: null,
        cable_length: null,
        status: 'active',
        created_date: null,
        created_by: null
      };

      const mockProjectData = {
        id: 'proj-trim-123',
        name: 'Trim Project',
        code: 'TRIM-2024',
        status: 'active'
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockDRData);
      vi.mocked(queryOne).mockResolvedValueOnce(mockProjectData);

      const result = await lookupDR(drNumber);

      expect(result.success).toBe(true);
      expect(result.data?.dr_number).toBe(trimmedDR);

      // Verify query was called with trimmed DR number
      expect(queryOne).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.arrayContaining([trimmedDR])
      );
    });
  });
});
