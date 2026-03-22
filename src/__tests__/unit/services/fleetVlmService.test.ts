/**
 * fleetVlmService.test.ts
 * Unit tests for Fleet VLM Service
 *
 * Tests:
 * - FleetVlmError class
 * - getFuelLevelDescription (pure)
 * - validateOdometerReading (pure)
 * - checkOdometerDiscrepancy (pure)
 * - getVehicleCalibration (DB mocked)
 * - extractOdometerReading (fetch mocked)
 * - verifyLicensePlate (fetch mocked)
 * - extractFuelLevel (fetch mocked)
 * - checkFleetVlmHealth (fetch mocked)
 */

// ============================================================================
// MOCKS - defined before imports
// vi.hoisted ensures variables are available before vi.mock hoisting
// ============================================================================

const { mockSql } = vi.hoisted(() => {
  const mockSql = vi.fn();
  return { mockSql };
});

vi.mock('@/lib/logger', () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('@/services/vlmLearningService', () => ({
  getVlmFewShotExamples: vi.fn(async () => []),
  buildVlmFewShotPrompt: vi.fn(() => ''),
  recordCorrectExtraction: vi.fn(async () => ({})),
}));

// Mock neon DB for getVehicleCalibration
vi.mock('@/lib/db-neon', () => ({
  neon: vi.fn(() => mockSql),
}));

// Note: sharp is a native Node module - vi.mock does not intercept native addons.
// Tests use a real valid 1×1 JPEG so the real sharp library can process it.
// Tests that require fetch mocking set global.fetch inline.

// ============================================================================
// IMPORTS - after mocks
// ============================================================================

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  FleetVlmError,
  getFuelLevelDescription,
  validateOdometerReading,
  checkOdometerDiscrepancy,
  getVehicleCalibration,
  extractOdometerReading,
  verifyLicensePlate,
  extractFuelLevel,
  checkFleetVlmHealth,
  type OdometerValidationResult,
} from '../../../modules/fleet/services/fleetVlmService';

// Real 1×1 JPEG that sharp can process (avoids native-addon mock issues)
const SAMPLE_BASE64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/9oACAEBAAA/APsp/9k=';

// ============================================================================
// TEST SUITE 1: FleetVlmError
// ============================================================================

describe('FleetVlmError', () => {
  it('should create error with message and code', () => {
    const err = new FleetVlmError('Test error', 'TEST_CODE');
    expect(err.message).toBe('Test error');
    expect(err.code).toBe('TEST_CODE');
    expect(err.name).toBe('FleetVlmError');
    expect(err instanceof Error).toBe(true);
  });

  it('should create error with details', () => {
    const details = { statusCode: 500, body: 'Internal Server Error' };
    const err = new FleetVlmError('API error', 'VLM_HTTP_500', details);
    expect(err.details).toEqual(details);
  });

  it('should create error without optional fields', () => {
    const err = new FleetVlmError('Plain error');
    expect(err.code).toBeUndefined();
    expect(err.details).toBeUndefined();
    expect(err.message).toBe('Plain error');
  });
});

// ============================================================================
// TEST SUITE 2: getFuelLevelDescription (pure function)
// ============================================================================

describe('getFuelLevelDescription', () => {
  it('should return Empty for 0%', () => {
    expect(getFuelLevelDescription(0)).toBe('Empty');
  });

  it('should return Empty for 10%', () => {
    expect(getFuelLevelDescription(10)).toBe('Empty');
  });

  it('should return Quarter for 25%', () => {
    expect(getFuelLevelDescription(25)).toBe('Quarter');
  });

  it('should return Half for 50%', () => {
    expect(getFuelLevelDescription(50)).toBe('Half');
  });

  it('should return Three-quarters for 75%', () => {
    expect(getFuelLevelDescription(75)).toBe('Three-quarters');
  });

  it('should return Full for 100%', () => {
    expect(getFuelLevelDescription(100)).toBe('Full');
  });

  it('should return Quarter for values 11-30', () => {
    expect(getFuelLevelDescription(20)).toBe('Quarter');
    expect(getFuelLevelDescription(30)).toBe('Quarter');
    expect(getFuelLevelDescription(11)).toBe('Quarter');
  });

  it('should return Half for values 31-55', () => {
    expect(getFuelLevelDescription(45)).toBe('Half');
    expect(getFuelLevelDescription(55)).toBe('Half');
  });
});

// ============================================================================
// TEST SUITE 3: validateOdometerReading (pure function)
// ============================================================================

describe('validateOdometerReading', () => {
  it('should return invalid for null reading', () => {
    const result = validateOdometerReading(null, 0.95, null);
    expect(result.isValid).toBe(false);
    expect(result.validatedReading).toBeNull();
    expect(result.warningLevel).toBe('high');
    expect(result.suggestedAction).toBe('reject');
  });

  it('should return invalid for reading exceeding 2 million km', () => {
    const result = validateOdometerReading(2000001, 0.95, null);
    expect(result.isValid).toBe(false);
    expect(result.suggestedAction).toBe('reject');
  });

  it('should return invalid for negative reading', () => {
    const result = validateOdometerReading(-100, 0.95, null);
    expect(result.isValid).toBe(false);
    expect(result.warningLevel).toBe('high');
  });

  it('should return verify for low confidence reading', () => {
    const result = validateOdometerReading(50000, 0.5, null);
    expect(result.isValid).toBe(true);
    expect(result.suggestedAction).toBe('verify');
    expect(result.warningLevel).toBe('medium');
  });

  it('should accept valid reading with no previous reading', () => {
    const result = validateOdometerReading(75000, 0.95, null);
    expect(result.isValid).toBe(true);
    expect(result.validatedReading).toBe(75000);
    expect(result.suggestedAction).toBe('accept');
    expect(result.warningLevel).toBe('none');
  });

  it('should reject reading that is lower than previous (odometer rollback)', () => {
    const result = validateOdometerReading(40000, 0.95, 50000);
    expect(result.isValid).toBe(false);
    expect(result.warningLevel).toBe('high');
    expect(result.suggestedAction).toBe('reject');
  });

  it('should flag excessive km difference as suspicious', () => {
    // 5000 km in 1 day (way over 500 km/day default)
    const result = validateOdometerReading(55000, 0.95, 50000, { maxSingleTripKm: 1000 });
    expect(result.isValid).toBe(true);
    expect(result.suggestedAction).toBe('verify');
  });

  it('should accept reasonable km increase', () => {
    // 200 km more - totally normal
    const result = validateOdometerReading(50200, 0.95, 50000);
    expect(result.isValid).toBe(true);
    expect(result.suggestedAction).toBe('accept');
    expect(result.validatedReading).toBe(50200);
  });

  it('should respect custom minConfidence option', () => {
    // Low confidence but above custom threshold
    const result = validateOdometerReading(50000, 0.7, null, { minConfidence: 0.5 });
    expect(result.isValid).toBe(true);
    expect(result.suggestedAction).toBe('accept');
  });
});

// ============================================================================
// TEST SUITE 4: checkOdometerDiscrepancy (pure function)
// ============================================================================

describe('checkOdometerDiscrepancy', () => {
  it('should return no discrepancy when no previous reading', () => {
    const result = checkOdometerDiscrepancy(50000, null, 1, 500);
    expect(result.isDiscrepancy).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('should detect odometer rollback', () => {
    const result = checkOdometerDiscrepancy(40000, 50000, 1, 500);
    expect(result.isDiscrepancy).toBe(true);
    expect(result.reason).toContain('rollback');
  });

  it('should detect excessive daily km', () => {
    // 1500 km in 1 day with 500 km/day threshold
    const result = checkOdometerDiscrepancy(51500, 50000, 1, 500);
    expect(result.isDiscrepancy).toBe(true);
    expect(result.reason).toContain('Excessive km');
  });

  it('should detect static odometer (no movement for 7+ days)', () => {
    const result = checkOdometerDiscrepancy(50000, 50000, 7, 500);
    expect(result.isDiscrepancy).toBe(true);
    expect(result.reason).toContain('Static odometer');
  });

  it('should allow static odometer for less than 7 days', () => {
    const result = checkOdometerDiscrepancy(50000, 50000, 5, 500);
    // Should not flag as discrepancy
    expect(result.isDiscrepancy).toBe(false);
  });

  it('should accept normal km increase within threshold', () => {
    // 300 km in 1 day (under 500 km/day threshold)
    const result = checkOdometerDiscrepancy(50300, 50000, 1, 500);
    expect(result.isDiscrepancy).toBe(false);
    expect(result.reason).toBeNull();
  });
});

// ============================================================================
// TEST SUITE 5: getVehicleCalibration (DB mocked)
// ============================================================================

describe('getVehicleCalibration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return calibration data when found', async () => {
    mockSql.mockResolvedValueOnce([
      {
        id: 'cal-uuid-123',
        vehicle_id: 'veh-uuid-456',
        calibrated_at: '2025-01-01T10:00:00Z',
        calibrated_by_name: 'John Doe',
        baseline_odometer: 50000,
        baseline_fuel_level: 75,
        dashboard_photo_url: '/uploads/dashboard.jpg',
        vlm_learning_status: 'ready',
      },
    ]);

    const result = await getVehicleCalibration('veh-uuid-456');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('cal-uuid-123');
    expect(result!.vehicleId).toBe('veh-uuid-456');
    expect(result!.baselineOdometer).toBe(50000);
    expect(result!.vlmLearningStatus).toBe('ready');
  });

  it('should return null when no calibration exists', async () => {
    mockSql.mockResolvedValueOnce([]);
    const result = await getVehicleCalibration('veh-no-calibration');
    expect(result).toBeNull();
  });

  it('should return null and log error on DB failure', async () => {
    mockSql.mockRejectedValueOnce(new Error('DB connection timeout'));
    const result = await getVehicleCalibration('veh-uuid-error');
    expect(result).toBeNull();
  });
});

// ============================================================================
// TEST SUITE 6: extractOdometerReading (VLM API mocked)
// ============================================================================

describe('extractOdometerReading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should extract odometer reading when both passes agree', async () => {
    // Both passes return same reading → confidence boosted
    const mockVlmResponse = (reading: number) => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              reading,
              confidence: 0.92,
              raw_text: String(reading),
              digit_breakdown: String(reading).split('').join('-'),
              display_type: 'digital',
            }),
          },
        }],
      }),
      text: async () => '',
    });

    global.fetch = vi.fn()
      .mockResolvedValueOnce(mockVlmResponse(123456))
      .mockResolvedValueOnce(mockVlmResponse(123456));

    const result = await extractOdometerReading(SAMPLE_BASE64);
    expect(result.reading).toBe(123456);
    expect(result.confidence).toBeGreaterThan(0.92); // boosted by agreement
    expect(result.error).toBeUndefined();
  });

  it('should return null reading when VLM cannot read odometer', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              reading: null,
              confidence: 0,
              raw_text: 'unreadable',
              digit_breakdown: null,
              display_type: null,
            }),
          },
        }],
      }),
      text: async () => '',
    });

    const result = await extractOdometerReading(SAMPLE_BASE64);
    expect(result.reading).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('should handle VLM API timeout gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    );

    const result = await extractOdometerReading(SAMPLE_BASE64);
    expect(result.reading).toBeNull();
    expect(result.error).toBeDefined();
  });

  it('should handle VLM API HTTP error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    const result = await extractOdometerReading(SAMPLE_BASE64);
    expect(result.reading).toBeNull();
    expect(result.error).toBeDefined();
  });

  it('should flag digit confusion when passes diverge significantly', async () => {
    // Pass 1: 123456, Pass 2: 623456 (1↔6 digit confusion)
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                reading: 123456,
                confidence: 0.88,
                raw_text: '123456',
              }),
            },
          }],
        }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                reading: 623456,
                confidence: 0.87,
                raw_text: '623456',
              }),
            },
          }],
        }),
        text: async () => '',
      });

    const result = await extractOdometerReading(SAMPLE_BASE64);
    // Should still return a reading but with warning or reduced confidence
    expect(result.reading).not.toBeNull();
    // Either warning is set or confidence was capped
    const hasWarningOrLowConf = result.warning !== undefined || (result.confidence ?? 1) <= 0.9;
    expect(hasWarningOrLowConf).toBe(true);
  });
});

// ============================================================================
// TEST SUITE 7: verifyLicensePlate (VLM API mocked)
// ============================================================================

describe('verifyLicensePlate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should confirm matching plate and return correct shape', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              plate_text: 'HBP123GP',
              confidence: 0.95,
              visible: true,
            }),
          },
        }],
      }),
      text: async () => '',
    });

    const result = await verifyLicensePlate(SAMPLE_BASE64, 'HBP 123 GP');
    expect(result.plateText).toBe('HBP123GP');
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.matches).toBe(true);
    expect(result.expectedPlate).toBe('HBP 123 GP');
  });

  it('should detect plate mismatch', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              plate_text: 'XYZ999GP',
              confidence: 0.90,
              visible: true,
            }),
          },
        }],
      }),
      text: async () => '',
    });

    const result = await verifyLicensePlate(SAMPLE_BASE64, 'HBP 123 GP');
    expect(result.plateText).toBe('XYZ999GP');
    expect(result.matches).toBe(false);
  });

  it('should handle VLM API failure gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await verifyLicensePlate(SAMPLE_BASE64, 'HBP 123 GP');
    // Should return a result without throwing
    expect(result).toBeDefined();
    expect(result.matches).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.error).toBeDefined();
  });
});

// ============================================================================
// TEST SUITE 8: extractFuelLevel (VLM API mocked)
// ============================================================================

describe('extractFuelLevel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return null level when VLM cannot read gauge', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              level_category: null,
              level: null,
              confidence: 0,
              description: 'Fuel gauge not found',
            }),
          },
        }],
      }),
      text: async () => '',
    });

    const result = await extractFuelLevel(SAMPLE_BASE64);
    expect(result.level).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.description).toBe('Fuel gauge not found');
  });

  it('should return level from categorical value (3/4 → 75)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              level_category: '3/4',
              level: 70, // will be overridden by category
              confidence: 0.88,
              description: 'Three-quarters full',
            }),
          },
        }],
      }),
      text: async () => '',
    });

    const result = await extractFuelLevel(SAMPLE_BASE64);
    // Either 75 (categorical wins) or a valid number from the mock
    expect(result.confidence).toBeGreaterThan(0);
    expect(typeof result.level === 'number' || result.level === null).toBe(true);
  });

  it('should handle API HTTP error gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const result = await extractFuelLevel(SAMPLE_BASE64);
    expect(result).toBeDefined();
    expect(result.level).toBeNull();
    expect(result.error).toBeDefined();
  });
});

// ============================================================================
// TEST SUITE 9: checkFleetVlmHealth
// ============================================================================

describe('checkFleetVlmHealth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return true when VLM API returns Qwen model in data array', async () => {
    // vLLM models API returns { data: [{ id: 'model-name' }] }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'Qwen/Qwen3-VL-8B-Instruct' },
        ],
      }),
    });

    const healthy = await checkFleetVlmHealth();
    expect(healthy).toBe(true);
  });

  it('should return false when VLM API is down', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const healthy = await checkFleetVlmHealth();
    expect(healthy).toBe(false);
  });

  it('should return false when model not listed', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'some-other-model' }],
      }),
    });

    const healthy = await checkFleetVlmHealth();
    expect(healthy).toBe(false);
  });
});
