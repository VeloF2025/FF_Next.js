/**
 * DR Lookup Service Tests
 *
 * Testing DR number lookup from SOW (onemap.drops) module with single
 * JOINed query that returns project details inline.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  lookupDR,
  clearDRCache,
  getDRFromCache
} from '../../services/drLookupService';

// Mock the database utility
vi.mock('../../utils/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn()
}));

// Mock the logger
vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogs: vi.fn(() => []), clearLogs: vi.fn() },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }))
}));

import { queryOne } from '../../utils/db';

type DRRow = {
  dr_number: string;
  pole_number: string | null;
  project_id: string | null;
  pon_code: string | null;
  zone_code: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  current_status: string | null;
  project_name: string | null;
  project_code: string | null;
};

function makeRow(overrides: Partial<DRRow> = {}): DRRow {
  return {
    dr_number: 'DR-2024-001',
    pole_number: 'POLE-123',
    project_id: 'proj-uuid-123',
    pon_code: '5',
    zone_code: '2',
    address: '123 Main Street, Cape Town',
    latitude: -33.9249,
    longitude: 18.4241,
    current_status: 'installed',
    project_name: 'Cape Town Fiber Rollout 2024',
    project_code: 'CT-2024',
    ...overrides,
  };
}

describe('DR Lookup Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDRCache();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('lookupDR - Valid DR Number', () => {
    it('should lookup a valid DR number and return complete details', async () => {
      const drNumber = 'DR-2024-001';
      vi.mocked(queryOne).mockResolvedValueOnce(makeRow({ dr_number: drNumber }));

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

      // Single JOINed query — no separate project lookup
      expect(queryOne).toHaveBeenCalledTimes(1);
      expect(queryOne).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('SELECT'),
        expect.arrayContaining([drNumber])
      );
    });

    it('should lookup DR with minimal fields (pole, PON, zone can be null)', async () => {
      const drNumber = 'DR-2024-002';
      vi.mocked(queryOne).mockResolvedValueOnce(
        makeRow({
          dr_number: drNumber,
          pole_number: null,
          project_id: 'proj-uuid-456',
          pon_code: null,
          zone_code: null,
          address: null,
          latitude: null,
          longitude: null,
          current_status: 'planned',
          project_name: 'Johannesburg Project',
          project_code: 'JHB-2024',
        })
      );

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
      const drNumber = 'DR-9999-999';
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const result = await lookupDR(drNumber);

      expect(result.success).toBe(false);
      expect(result.error).toBe('DR number not found');
      expect(result.data).toBeNull();
      expect(queryOne).toHaveBeenCalledTimes(1);
    });

    it('should return error for empty DR number', async () => {
      const result = await lookupDR('');

      expect(result.success).toBe(false);
      expect(result.error).toBe('DR number is required');
      expect(result.data).toBeNull();
      expect(queryOne).not.toHaveBeenCalled();
    });

    it('should return error for whitespace-only DR number', async () => {
      const result = await lookupDR('   ');

      expect(result.success).toBe(false);
      expect(result.error).toBe('DR number is required');
      expect(result.data).toBeNull();
      expect(queryOne).not.toHaveBeenCalled();
    });
  });

  describe('lookupDR - Returns Project Info', () => {
    it('should include full project details in result', async () => {
      const drNumber = 'DR-2024-003';
      vi.mocked(queryOne).mockResolvedValueOnce(
        makeRow({
          dr_number: drNumber,
          pole_number: 'POLE-456',
          project_id: 'proj-uuid-789',
          pon_code: '3',
          zone_code: '1',
          address: '456 Oak Avenue',
          project_name: 'Western Cape Network Expansion',
          project_code: 'WC-EXP-2024',
        })
      );

      const result = await lookupDR(drNumber);

      expect(result.success).toBe(true);
      expect(result.data?.project_id).toBe('proj-uuid-789');
      expect(result.data?.project_name).toBe('Western Cape Network Expansion');
      expect(result.data?.project_code).toBe('WC-EXP-2024');
    });

    it('should handle DR without project (orphaned DR)', async () => {
      const drNumber = 'DR-2024-004';
      vi.mocked(queryOne).mockResolvedValueOnce(
        makeRow({
          dr_number: drNumber,
          pole_number: 'POLE-789',
          project_id: 'invalid-project-id',
          pon_code: '4',
          zone_code: '3',
          address: '789 Elm Street',
          latitude: null,
          longitude: null,
          current_status: 'planned',
          // Project JOIN returned null on missing project
          project_name: null,
          project_code: null,
        })
      );

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
      const drNumber = 'DR-2024-005';
      vi.mocked(queryOne).mockResolvedValueOnce(
        makeRow({
          dr_number: drNumber,
          pole_number: 'POLE-999',
          project_id: 'proj-uuid-111',
          pon_code: '12',
          zone_code: '7',
          address: '999 Pine Road',
          project_name: 'Stellenbosch Fiber Project',
          project_code: 'SB-2024',
        })
      );

      const result = await lookupDR(drNumber);

      expect(result.success).toBe(true);
      expect(result.data?.zone_number).toBe(7);
      expect(result.data?.pon_number).toBe(12);
    });
  });

  describe('lookupDR - Caching', () => {
    it('should cache DR lookup results to reduce database queries', async () => {
      const drNumber = 'DR-2024-006';
      vi.mocked(queryOne).mockResolvedValueOnce(
        makeRow({
          dr_number: drNumber,
          pole_number: 'POLE-CACHE',
          project_id: 'proj-cache-123',
          pon_code: '8',
          zone_code: '4',
          address: 'Cache Street',
          latitude: null,
          longitude: null,
          current_status: 'active',
          project_name: 'Cache Test Project',
          project_code: 'CACHE-2024',
        })
      );

      // First lookup — should hit database
      const result1 = await lookupDR(drNumber);
      expect(result1.success).toBe(true);
      expect(queryOne).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Second lookup — should use cache
      const result2 = await lookupDR(drNumber);
      expect(result2.success).toBe(true);
      expect(result2.data?.dr_number).toBe(drNumber);
      expect(result2.data?.pole_number).toBe('POLE-CACHE');
      expect(queryOne).not.toHaveBeenCalled();
    });

    it('should allow manual cache clearing', async () => {
      const drNumber = 'DR-2024-007';
      const row = makeRow({
        dr_number: drNumber,
        pole_number: 'POLE-CLEAR',
        project_id: 'proj-clear-123',
        pon_code: '9',
        zone_code: '5',
        address: 'Clear Street',
        latitude: null,
        longitude: null,
        current_status: 'active',
        project_name: 'Clear Cache Project',
        project_code: 'CLEAR-2024',
      });

      vi.mocked(queryOne).mockResolvedValueOnce(row);

      // First lookup
      await lookupDR(drNumber);
      expect(queryOne).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Cached
      await lookupDR(drNumber);
      expect(queryOne).not.toHaveBeenCalled();

      // Clear cache and re-query
      clearDRCache();
      vi.mocked(queryOne).mockResolvedValueOnce(row);
      await lookupDR(drNumber);
      expect(queryOne).toHaveBeenCalledTimes(1);
    });

    it('should provide cache retrieval function', () => {
      const drNumber = 'DR-2024-008';

      const cachedResult1 = getDRFromCache(drNumber);
      expect(cachedResult1).toBeNull();

      clearDRCache();
      const cachedResult2 = getDRFromCache(drNumber);
      expect(cachedResult2).toBeNull();
    });
  });

  describe('lookupDR - Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      const drNumber = 'DR-2024-009';
      vi.mocked(queryOne).mockRejectedValueOnce(new Error('Database connection failed'));

      const result = await lookupDR(drNumber);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to lookup DR number');
      expect(result.data).toBeNull();
    });

    it('should handle database query timeout', async () => {
      const drNumber = 'DR-2024-010';
      vi.mocked(queryOne).mockRejectedValueOnce(new Error('Query timeout exceeded'));

      const result = await lookupDR(drNumber);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to lookup DR number');
      expect(result.data).toBeNull();
    });

    it('should handle malformed database response', async () => {
      const drNumber = 'DR-2024-012';
      vi.mocked(queryOne).mockResolvedValueOnce({
        some_random_field: 'value',
      } as unknown as Parameters<typeof queryOne>[0]);

      const result = await lookupDR(drNumber);

      expect(result.success).toBe(false);
      expect(result.error).toBe('DR number not found');
      expect(result.data).toBeNull();
    });
  });

  describe('lookupDR - Input Validation', () => {
    it('should trim whitespace from DR number', async () => {
      const drNumber = '  DR-2024-013  ';
      const trimmedDR = 'DR-2024-013';

      vi.mocked(queryOne).mockResolvedValueOnce(
        makeRow({
          dr_number: trimmedDR,
          pole_number: 'POLE-TRIM',
          project_id: 'proj-trim-123',
          pon_code: '11',
          zone_code: '7',
          address: 'Trim Street',
          latitude: null,
          longitude: null,
          current_status: 'active',
          project_name: 'Trim Project',
          project_code: 'TRIM-2024',
        })
      );

      const result = await lookupDR(drNumber);

      expect(result.success).toBe(true);
      expect(result.data?.dr_number).toBe(trimmedDR);
      expect(queryOne).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.arrayContaining([trimmedDR])
      );
    });
  });
});
