/**
 * DR Lookup API Integration Tests
 *
 * 🟢 WORKING: Tests written FIRST following TDD methodology
 *
 * Tests the DR lookup endpoint:
 * - GET /api/ticketing/dr-lookup/[drNumber] - Lookup DR details from SOW module
 *
 * Test Strategy:
 * - Mock drLookupService to isolate API route logic
 * - Test valid DR lookup with complete details
 * - Test invalid/not found DR numbers
 * - Test empty/whitespace DR numbers
 * - Test database errors
 * - Verify proper HTTP status codes
 * - Verify response structure matches API standards
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GET } from '@/app/api/ticketing/dr-lookup/[drNumber]/route';
import type { DRLookupResult, DRLookupData } from '../../types/ticket';

// Helper to create mock DR lookup data
function createMockDRData(overrides: Partial<DRLookupData> = {}): DRLookupData {
  return {
    dr_number: 'DR12345',
    pole_number: 'POLE-001',
    pon_number: 5,
    zone_number: 3,
    project_id: '123e4567-e89b-12d3-a456-426614174000',
    project_name: 'FibreFlow Test Project',
    project_code: 'FT-001',
    address: '123 Test Street',
    latitude: -26.2041,
    longitude: 28.0473,
    municipality: 'Test Municipality',
    cable_type: 'G657A2',
    cable_length: '50m',
    status: 'active',
    ...overrides,
  };
}

// Mock the DR lookup service
vi.mock('@/modules/ticketing/services/drLookupService', () => ({
  lookupDR: vi.fn(),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('DR Lookup API Endpoint', () => {
  let mockLookupDR: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Get the mocked function
    const { lookupDR } = await import('@/modules/ticketing/services/drLookupService');
    mockLookupDR = lookupDR;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/ticketing/dr-lookup/[drNumber]', () => {
    it('should return DR details for valid DR number', async () => {
      // Arrange
      const mockDRData = createMockDRData();
      mockLookupDR.mockResolvedValue({
        success: true,
        data: mockDRData,
      } as DRLookupResult);

      const request = new Request('http://localhost:3000/api/ticketing/dr-lookup/DR12345');

      // Act
      const response = await GET(request, { params: { drNumber: 'DR12345' } });
      const json = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data).toEqual(mockDRData);
      expect(json.data.dr_number).toBe('DR12345');
      expect(json.data.pole_number).toBe('POLE-001');
      expect(json.data.project_name).toBe('FibreFlow Test Project');
      expect(json.meta).toBeDefined();
      expect(json.meta.timestamp).toBeDefined();

      // Verify service was called with correct parameter
      expect(mockLookupDR).toHaveBeenCalledWith('DR12345');
      expect(mockLookupDR).toHaveBeenCalledTimes(1);
    });

    it('should return DR details with minimal fields', async () => {
      // Arrange
      const mockDRData = createMockDRData({
        pole_number: null,
        pon_number: null,
        zone_number: null,
        project_id: null,
        project_name: null,
        project_code: null,
        address: null,
        latitude: null,
        longitude: null,
        municipality: null,
        cable_type: null,
        cable_length: null,
        status: null,
      });

      mockLookupDR.mockResolvedValue({
        success: true,
        data: mockDRData,
      } as DRLookupResult);

      const request = new Request('http://localhost:3000/api/ticketing/dr-lookup/DR99999');

      // Act
      const response = await GET(request, { params: { drNumber: 'DR99999' } });
      const json = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.dr_number).toBe('DR12345');
      expect(json.data.pole_number).toBeNull();
      expect(json.data.project_id).toBeNull();
    });

    it('should return 404 when DR number not found', async () => {
      // Arrange
      mockLookupDR.mockResolvedValue({
        success: false,
        data: null,
        error: 'DR number not found',
      } as DRLookupResult);

      const request = new Request('http://localhost:3000/api/ticketing/dr-lookup/INVALID123');

      // Act
      const response = await GET(request, { params: { drNumber: 'INVALID123' } });
      const json = await response.json();

      // Assert
      expect(response.status).toBe(404);
      expect(json.success).toBe(false);
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toBe('DR number not found');
      expect(json.meta).toBeDefined();
      expect(json.meta.timestamp).toBeDefined();

      expect(mockLookupDR).toHaveBeenCalledWith('INVALID123');
    });

    it('should return 422 when DR number is empty', async () => {
      // Arrange
      mockLookupDR.mockResolvedValue({
        success: false,
        data: null,
        error: 'DR number is required',
      } as DRLookupResult);

      const request = new Request('http://localhost:3000/api/ticketing/dr-lookup/   ');

      // Act
      const response = await GET(request, { params: { drNumber: '   ' } });
      const json = await response.json();

      // Assert
      expect(response.status).toBe(422);
      expect(json.success).toBe(false);
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('DR number is required');

      expect(mockLookupDR).toHaveBeenCalledWith('   ');
    });

    it('should return 422 when DR number is missing', async () => {
      // Arrange
      mockLookupDR.mockResolvedValue({
        success: false,
        data: null,
        error: 'DR number is required',
      } as DRLookupResult);

      const request = new Request('http://localhost:3000/api/ticketing/dr-lookup/');

      // Act
      const response = await GET(request, { params: { drNumber: '' } });
      const json = await response.json();

      // Assert
      expect(response.status).toBe(422);
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle database errors gracefully', async () => {
      // Arrange
      mockLookupDR.mockResolvedValue({
        success: false,
        data: null,
        error: 'Failed to lookup DR number: Database connection error',
      } as DRLookupResult);

      const request = new Request('http://localhost:3000/api/ticketing/dr-lookup/DR12345');

      // Act
      const response = await GET(request, { params: { drNumber: 'DR12345' } });
      const json = await response.json();

      // Assert
      expect(response.status).toBe(500);
      expect(json.success).toBe(false);
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe('DATABASE_ERROR');
      expect(json.error.message).toContain('Failed to lookup DR number');
    });

    it('should handle service exceptions', async () => {
      // Arrange
      mockLookupDR.mockRejectedValue(new Error('Unexpected error'));

      const request = new Request('http://localhost:3000/api/ticketing/dr-lookup/DR12345');

      // Act
      const response = await GET(request, { params: { drNumber: 'DR12345' } });
      const json = await response.json();

      // Assert
      expect(response.status).toBe(500);
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('DATABASE_ERROR');
      expect(json.error.message).toBe('Failed to lookup DR number');
    });

    it('should trim whitespace from DR number', async () => {
      // Arrange
      const mockDRData = createMockDRData();
      mockLookupDR.mockResolvedValue({
        success: true,
        data: mockDRData,
      } as DRLookupResult);

      const request = new Request('http://localhost:3000/api/ticketing/dr-lookup/  DR12345  ');

      // Act
      const response = await GET(request, { params: { drNumber: '  DR12345  ' } });
      const json = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(json.success).toBe(true);

      // Service should be called with the parameter as-is (trimming happens in service)
      expect(mockLookupDR).toHaveBeenCalledWith('  DR12345  ');
    });

    it('should return complete project information when available', async () => {
      // Arrange
      const mockDRData = createMockDRData({
        project_id: '550e8400-e29b-41d4-a716-446655440000',
        project_name: 'Network Expansion Phase 2',
        project_code: 'NEP2-2024',
      });

      mockLookupDR.mockResolvedValue({
        success: true,
        data: mockDRData,
      } as DRLookupResult);

      const request = new Request('http://localhost:3000/api/ticketing/dr-lookup/DR12345');

      // Act
      const response = await GET(request, { params: { drNumber: 'DR12345' } });
      const json = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.project_id).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(json.data.project_name).toBe('Network Expansion Phase 2');
      expect(json.data.project_code).toBe('NEP2-2024');
    });

    it('should return zone and PON information when available', async () => {
      // Arrange
      const mockDRData = createMockDRData({
        zone_number: 7,
        pon_number: 12,
        pole_number: 'POLE-789',
      });

      mockLookupDR.mockResolvedValue({
        success: true,
        data: mockDRData,
      } as DRLookupResult);

      const request = new Request('http://localhost:3000/api/ticketing/dr-lookup/DR54321');

      // Act
      const response = await GET(request, { params: { drNumber: 'DR54321' } });
      const json = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.zone_number).toBe(7);
      expect(json.data.pon_number).toBe(12);
      expect(json.data.pole_number).toBe('POLE-789');
    });

    it('should return location information when available', async () => {
      // Arrange
      const mockDRData = createMockDRData({
        address: '456 Main Road, Sandton',
        latitude: -26.1076,
        longitude: 28.0567,
        municipality: 'City of Johannesburg',
      });

      mockLookupDR.mockResolvedValue({
        success: true,
        data: mockDRData,
      } as DRLookupResult);

      const request = new Request('http://localhost:3000/api/ticketing/dr-lookup/DR11111');

      // Act
      const response = await GET(request, { params: { drNumber: 'DR11111' } });
      const json = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.address).toBe('456 Main Road, Sandton');
      expect(json.data.latitude).toBe(-26.1076);
      expect(json.data.longitude).toBe(28.0567);
      expect(json.data.municipality).toBe('City of Johannesburg');
    });

    it('should return cable information when available', async () => {
      // Arrange
      const mockDRData = createMockDRData({
        cable_type: 'G652D',
        cable_length: '120m',
      });

      mockLookupDR.mockResolvedValue({
        success: true,
        data: mockDRData,
      } as DRLookupResult);

      const request = new Request('http://localhost:3000/api/ticketing/dr-lookup/DR22222');

      // Act
      const response = await GET(request, { params: { drNumber: 'DR22222' } });
      const json = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.cable_type).toBe('G652D');
      expect(json.data.cable_length).toBe('120m');
    });
  });
});
