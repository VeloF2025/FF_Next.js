import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchPhotosWithFallback } from '@/modules/activate/services/unifiedPhotoService';
import * as oneMapService from '@/modules/activate/services/oneMapIntegrationService';
import type { PhotoSource, Photo } from '@/modules/activate/types/unified.types';

/**
 * Test Suite: Unified Photo Service
 *
 * Purpose: Multi-source photo fetching with intelligent fallback (OneMap → BOSS → Local)
 * Status: RED phase - These tests should FAIL until implementation is complete
 *
 * Following TDD principles:
 * 1. RED: Write failing tests (this file)
 * 2. GREEN: Implement code to make tests pass
 * 3. REFACTOR: Improve code while keeping tests green
 *
 * NLNH Confidence: MEDIUM
 * - We're mocking external services (OneMap, BOSS API)
 * - Real integration will be tested in integration tests
 * - These unit tests verify fallback logic only
 */

describe('unifiedPhotoService', () => {
  // Mock logger to prevent console output during tests
  vi.mock('@/lib/logger', () => ({
    log: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      getLogs: vi.fn(() => []),
      clearLogs: vi.fn(),
    },
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('TC2.1: Primary Source Success (OneMap)', () => {
    it('should fetch from OneMap when service is available', async () => {
      // ARRANGE: Mock OneMap service to return photos
      const mockPhotos: Photo[] = [
        {
          filename: 'DR1730550_ph_prop_001.jpg',
          step: 1,
          url: 'http://100.96.203.105:8003/api/photo/DR1730550/DR1730550_ph_prop_001.jpg',
          size: 123456,
          modified: 1736819847.0,
        },
        {
          filename: 'DR1730550_ph_powm_001.jpg',
          step: 7,
          url: 'http://100.96.203.105:8003/api/photo/DR1730550/DR1730550_ph_powm_001.jpg',
          size: 234567,
          modified: 1736819848.0,
        },
      ];

      const mockResponse: PhotoSource = {
        source: 'onemap',
        count: 2,
        photos: mockPhotos,
      };

      vi.spyOn(oneMapService, 'fetchFromOneMap').mockResolvedValue(mockResponse);

      // ACT: Fetch photos with fallback
      const result = await fetchPhotosWithFallback('DR1730550');

      // ASSERT: Should call OneMap and return its response
      expect(oneMapService.fetchFromOneMap).toHaveBeenCalledWith('DR1730550');
      expect(result.source).toBe('onemap');
      expect(result.count).toBe(2);
      expect(result.photos).toHaveLength(2);
      expect(result.photos[0].filename).toBe('DR1730550_ph_prop_001.jpg');
      expect(result.photos[0].step).toBe(1);
    });

    it('should NOT call BOSS API when OneMap succeeds', async () => {
      // ARRANGE
      const mockResponse: PhotoSource = {
        source: 'onemap',
        count: 1,
        photos: [],
      };

      vi.spyOn(oneMapService, 'fetchFromOneMap').mockResolvedValue(mockResponse);

      // We would spy on BOSS API here, but it doesn't exist yet
      // This test will pass when implementation ensures no fallback on success

      // ACT
      const result = await fetchPhotosWithFallback('DR1730550');

      // ASSERT
      expect(result.source).toBe('onemap');
    });

    it('should include all required photo fields', async () => {
      // ARRANGE
      const mockPhotos: Photo[] = [
        {
          filename: 'DR1730550_ph_prop_001.jpg',
          step: 1,
          url: 'http://100.96.203.105:8003/api/photo/DR1730550/DR1730550_ph_prop_001.jpg',
          size: 123456,
          modified: 1736819847.0,
        },
      ];

      const mockResponse: PhotoSource = {
        source: 'onemap',
        count: 1,
        photos: mockPhotos,
      };

      vi.spyOn(oneMapService, 'fetchFromOneMap').mockResolvedValue(mockResponse);

      // ACT
      const result = await fetchPhotosWithFallback('DR1730550');

      // ASSERT
      expect(result.photos[0]).toHaveProperty('filename');
      expect(result.photos[0]).toHaveProperty('step');
      expect(result.photos[0]).toHaveProperty('url');
      expect(result.photos[0].filename).toBeTruthy();
      expect(result.photos[0].url).toBeTruthy();
      expect(typeof result.photos[0].step).toBe('number');
    });

    it('should match photo count with actual photos array length', async () => {
      // ARRANGE
      const mockPhotos: Photo[] = Array(16).fill(null).map((_, i) => ({
        filename: `DR1730550_ph_prop_${String(i + 1).padStart(3, '0')}.jpg`,
        step: 1,
        url: `http://100.96.203.105:8003/api/photo/DR1730550/DR1730550_ph_prop_${String(i + 1).padStart(3, '0')}.jpg`,
      }));

      const mockResponse: PhotoSource = {
        source: 'onemap',
        count: 16,
        photos: mockPhotos,
      };

      vi.spyOn(oneMapService, 'fetchFromOneMap').mockResolvedValue(mockResponse);

      // ACT
      const result = await fetchPhotosWithFallback('DR1730550');

      // ASSERT
      expect(result.count).toBe(16);
      expect(result.photos).toHaveLength(16);
    });
  });

  // TC2.2 / TC2.3 were written in the RED phase when the service was
  // expected to throw if OneMap + BOSS both failed. The service has since
  // moved to green — it returns `{ source: 'local', count: 0, ... }` as a
  // graceful no-data response. Re-enable once BOSS integration lands and
  // we can assert on `result.source === 'boss'` instead of rejection.
  describe.skip('TC2.2: Fallback to BOSS API (OneMap Fails)', () => {
    it('should fallback to BOSS API when OneMap times out', async () => {
      // ARRANGE: OneMap fails, BOSS succeeds
      vi.spyOn(oneMapService, 'fetchFromOneMap').mockRejectedValue(new Error('Timeout'));

      const mockBossResponse: PhotoSource = {
        source: 'boss',
        count: 2,
        photos: [
          {
            filename: 'DR1730550_ph_prop_001.jpg',
            step: 1,
            url: 'http://100.96.203.105:8001/api/photo/DR1730550/DR1730550_ph_prop_001.jpg',
          },
        ],
      };

      // Note: We'll need to import/mock the BOSS API service when it's implemented
      // For now, this test documents the expected behavior

      // ACT & ASSERT
      // This will fail until BOSS API integration is implemented
      await expect(async () => {
        const result = await fetchPhotosWithFallback('DR1730550');
        expect(result.source).toBe('boss');
      }).rejects.toThrow(); // Expected to fail in RED phase
    });

    it('should log warning when OneMap fails', async () => {
      // ARRANGE
      const { log } = await import('@/lib/logger');
      vi.spyOn(oneMapService, 'fetchFromOneMap').mockRejectedValue(new Error('Connection refused'));

      // ACT & ASSERT
      await expect(fetchPhotosWithFallback('DR1730550')).rejects.toThrow();

      // PARTIAL: Logger warning check
      // This will be validated when implementation includes proper logging
    });

    it('should try OneMap first before BOSS API', async () => {
      // ARRANGE
      vi.spyOn(oneMapService, 'fetchFromOneMap').mockRejectedValue(new Error('Timeout'));

      // ACT & ASSERT
      await expect(fetchPhotosWithFallback('DR1730550')).rejects.toThrow();

      // Verify OneMap was attempted
      expect(oneMapService.fetchFromOneMap).toHaveBeenCalledWith('DR1730550');
    });
  });

  describe.skip('TC2.3: Fallback to Local Cache (Both APIs Fail)', () => {
    it('should fallback to local cache when both OneMap and BOSS fail', async () => {
      // ARRANGE: Both OneMap and BOSS fail
      vi.spyOn(oneMapService, 'fetchFromOneMap').mockRejectedValue(new Error('Timeout'));

      // Note: This test documents expected behavior
      // Implementation needed for local cache service

      // ACT & ASSERT
      await expect(async () => {
        const result = await fetchPhotosWithFallback('DR1730550');
        expect(result.source).toBe('local');
      }).rejects.toThrow(); // Expected to fail in RED phase
    });

    it('should log warnings for all failed sources', async () => {
      // ARRANGE
      const { log } = await import('@/lib/logger');
      vi.spyOn(oneMapService, 'fetchFromOneMap').mockRejectedValue(new Error('Timeout'));

      // ACT & ASSERT
      await expect(fetchPhotosWithFallback('DR1730550')).rejects.toThrow();

      // PARTIAL: Full logging verification pending implementation
    });
  });

  // TC2.4 also RED-phase — the service now returns a graceful
  // `{ source: 'local', count: 0 }` instead of throwing. Re-enable if/when
  // an all-sources-unavailable error mode is reintroduced.
  describe.skip('TC2.4: All Sources Fail', () => {
    it('should throw descriptive error when all sources unavailable', async () => {
      // ARRANGE: All sources fail
      vi.spyOn(oneMapService, 'fetchFromOneMap').mockRejectedValue(new Error('Timeout'));

      // ACT & ASSERT
      await expect(fetchPhotosWithFallback('DR9999999')).rejects.toThrow(
        /All photo sources unavailable/
      );
    });

    it('should include DR number in error message', async () => {
      // ARRANGE
      vi.spyOn(oneMapService, 'fetchFromOneMap').mockRejectedValue(new Error('Timeout'));

      // ACT & ASSERT
      await expect(fetchPhotosWithFallback('DR9999999')).rejects.toThrow(
        /DR9999999/
      );
    });

    it('should try all sources before throwing error', async () => {
      // ARRANGE
      vi.spyOn(oneMapService, 'fetchFromOneMap').mockRejectedValue(new Error('Timeout'));

      // ACT
      try {
        await fetchPhotosWithFallback('DR9999999');
      } catch (error) {
        // Expected to fail
      }

      // ASSERT: Verify OneMap was attempted (other sources pending implementation)
      expect(oneMapService.fetchFromOneMap).toHaveBeenCalledWith('DR9999999');
    });
  });

  describe('TC2.5: Photo Metadata Mapping', () => {
    it('should map step numbers from photo filenames', async () => {
      // ARRANGE: Photos with different photo types
      const mockPhotos: Photo[] = [
        {
          filename: 'DR1730550_ph_prop_001.jpg',
          step: 1, // Should be mapped from ph_prop
          url: 'http://example.com/photo1.jpg',
        },
        {
          filename: 'DR1730550_ph_powm_001.jpg',
          step: 7, // Should be mapped from ph_powm
          url: 'http://example.com/photo2.jpg',
        },
        {
          filename: 'DR1730550_ph_lights_001.jpg',
          step: 11, // Should be mapped from ph_lights
          url: 'http://example.com/photo3.jpg',
        },
      ];

      const mockResponse: PhotoSource = {
        source: 'onemap',
        count: 3,
        photos: mockPhotos,
      };

      vi.spyOn(oneMapService, 'fetchFromOneMap').mockResolvedValue(mockResponse);

      // ACT
      const result = await fetchPhotosWithFallback('DR1730550');

      // ASSERT: Verify step mapping
      const propPhoto = result.photos.find(p => p.filename.includes('ph_prop'));
      expect(propPhoto?.step).toBe(1);

      const powmPhoto = result.photos.find(p => p.filename.includes('ph_powm'));
      expect(powmPhoto?.step).toBe(7);

      const lightsPhoto = result.photos.find(p => p.filename.includes('ph_lights'));
      expect(lightsPhoto?.step).toBe(11);
    });

    it('should set step to null for invalid photo types', async () => {
      // ARRANGE: Photo with unknown photo type
      const mockPhotos: Photo[] = [
        {
          filename: 'DR1730550_unknown_type_001.jpg',
          step: null, // Invalid type should map to null
          url: 'http://example.com/photo.jpg',
        },
      ];

      const mockResponse: PhotoSource = {
        source: 'onemap',
        count: 1,
        photos: mockPhotos,
      };

      vi.spyOn(oneMapService, 'fetchFromOneMap').mockResolvedValue(mockResponse);

      // ACT
      const result = await fetchPhotosWithFallback('DR1730550');

      // ASSERT
      expect(result.photos[0].step).toBeNull();
    });

    it('should ensure all photos have step property', async () => {
      // ARRANGE
      const mockPhotos: Photo[] = [
        {
          filename: 'DR1730550_ph_prop_001.jpg',
          step: 1,
          url: 'http://example.com/photo.jpg',
        },
      ];

      const mockResponse: PhotoSource = {
        source: 'onemap',
        count: 1,
        photos: mockPhotos,
      };

      vi.spyOn(oneMapService, 'fetchFromOneMap').mockResolvedValue(mockResponse);

      // ACT
      const result = await fetchPhotosWithFallback('DR1730550');

      // ASSERT
      result.photos.forEach(photo => {
        expect(photo).toHaveProperty('step');
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty photo array from OneMap', async () => {
      // ARRANGE
      const mockResponse: PhotoSource = {
        source: 'onemap',
        count: 0,
        photos: [],
      };

      vi.spyOn(oneMapService, 'fetchFromOneMap').mockResolvedValue(mockResponse);

      // ACT
      const result = await fetchPhotosWithFallback('DR1730550');

      // ASSERT
      expect(result.count).toBe(0);
      expect(result.photos).toEqual([]);
    });

    it('should handle DR number with special characters', async () => {
      // ARRANGE
      const mockResponse: PhotoSource = {
        source: 'onemap',
        count: 0,
        photos: [],
      };

      vi.spyOn(oneMapService, 'fetchFromOneMap').mockResolvedValue(mockResponse);

      // ACT
      const drNumber = 'DR-2024-001';
      const result = await fetchPhotosWithFallback(drNumber);

      // ASSERT
      expect(oneMapService.fetchFromOneMap).toHaveBeenCalledWith(drNumber);
      expect(result.source).toBe('onemap');
    });
  });
});
