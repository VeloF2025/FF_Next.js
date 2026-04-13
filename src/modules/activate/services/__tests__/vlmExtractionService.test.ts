/**
 * vlmExtractionService.test.ts
 * Unit tests for VLM extraction service
 * Tests core functions with mocked VLM API and photo services
 */

// ============================================================================
// MOCKS - MUST BE DEFINED FIRST
// ============================================================================

// Mock logger
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

// Mock vlmLearningService (doesn't exist yet, so mock the module directly)
vi.mock('@/services/vlmLearningService', () => ({
  getVlmFewShotExamples: vi.fn(async () => []),
  buildVlmFewShotPrompt: vi.fn(() => ''),
  recordCorrectExtraction: vi.fn(async () => ({})),
}));

// Mock external services
vi.mock('../photoFetchService');
vi.mock('../barcodeExtractionService');
vi.mock('../imagePreprocessService');

// ============================================================================
// IMPORTS - AFTER MOCKS ARE DEFINED
// ============================================================================

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as vlmService from '../vlmExtractionService';
import * as photoFetchService from '../photoFetchService';
import * as barcodeService from '../barcodeExtractionService';
import * as imagePreprocessService from '../imagePreprocessService';

// Sample base64 image (minimal valid JPEG header)
const SAMPLE_BASE64_IMAGE = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8VAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=';


// ============================================================================
// TEST SUITE 1: PUBLIC UTILITY FUNCTIONS
// ============================================================================

describe('vlmExtractionService - Public Utility Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // TEST 1: serialsMatch is case-insensitive
  it('should match serials case-insensitively and trim whitespace', () => {
    expect(vlmService.serialsMatch(' alclb48d1234 ', 'ALCLB48D1234')).toBe(true);
  });

  // TEST 2: serialsMatch handles null values
  it('should return false when either serial is null', () => {
    expect(vlmService.serialsMatch(null, 'ALCLB48D1234')).toBe(false);
    expect(vlmService.serialsMatch('ALCLB48D1234', null)).toBe(false);
  });

  // TEST 3: drNumbersMatch handles DR prefix
  it('should match DR numbers regardless of DR prefix', () => {
    expect(vlmService.drNumbersMatch('DR1234567', '1234567')).toBe(true);
    expect(vlmService.drNumbersMatch('1234567', 'DR1234567')).toBe(true);
    expect(vlmService.drNumbersMatch('DR1234567', 'DR1234567')).toBe(true);
  });

  // TEST 4: drNumbersMatch rejects non-matching numbers
  it('should reject non-matching DR numbers', () => {
    expect(vlmService.drNumbersMatch('DR1234567', 'DR9999999')).toBe(false);
    expect(vlmService.drNumbersMatch('1234567', '9999999')).toBe(false);
  });

  // TEST 5: drNumbersMatch handles null values
  it('should reject null DR numbers in drNumbersMatch', () => {
    expect(vlmService.drNumbersMatch(null, 'DR1234567')).toBe(false);
    expect(vlmService.drNumbersMatch('', 'DR1234567')).toBe(false);
  });
});

// ============================================================================
// TEST SUITE 2: POWER METER EXTRACTION
// ============================================================================

describe('vlmExtractionService - Power Meter Extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock photoFetchService
    vi.mocked(photoFetchService.fetchPhotoAsBase64).mockResolvedValue(SAMPLE_BASE64_IMAGE);

    // Mock imagePreprocessService - return image as-is
    vi.mocked(imagePreprocessService.preprocessImage).mockResolvedValue({
      wasPreprocessed: false,
      imageBase64: SAMPLE_BASE64_IMAGE,
    });

    vi.mocked(imagePreprocessService.optimizeForVlm).mockResolvedValue(SAMPLE_BASE64_IMAGE);

    vi.mocked(imagePreprocessService.detectBlur).mockResolvedValue({
      isBlurry: false,
      score: 0.3,
      threshold: 0.5,
      assessment: 'Clear',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TEST 11: extractPowerMeterReading - success case
  it('should extract power meter reading successfully', async () => {
    // Mock successful VLM API response
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                found: true,
                value: -24.5,
                rawText: '-24.5 dBm',
                confidence: 0.95,
              }),
            },
          },
        ],
      }),
      text: async () => '',
    });

    const result = await vlmService.extractPowerMeterReading('http://example.com/step7.jpg');

    expect(result.success).toBe(true);
    expect(result.value).toBe(-24.5);
    expect(result.unit).toBe('dBm');
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.rawText).toBe('-24.5 dBm');
  });

  // TEST 12: extractPowerMeterReading - not found
  it('should handle case when power meter is not found in image', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                found: false,
                value: null,
                rawText: null,
                confidence: 0.1,
              }),
            },
          },
        ],
      }),
      text: async () => '',
    });

    const result = await vlmService.extractPowerMeterReading('http://example.com/step7.jpg');

    expect(result.success).toBe(false);
    expect(result.value).toBeNull();
    expect(result.confidence).toBeLessThan(0.2);
  });

  // TEST 13: extractPowerMeterReading - API timeout
  it('should handle VLM API timeout gracefully', async () => {
    global.fetch = vi.fn().mockImplementationOnce(() => {
      return new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timeout')), 100);
      });
    });

    const result = await vlmService.extractPowerMeterReading('http://example.com/step7.jpg');

    expect(result.success).toBe(false);
    expect(result.value).toBeNull();
    expect(result.error).toBeDefined();
  });

  // TEST 14: extractPowerMeterReading - API error response
  it('should handle VLM API error responses', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const result = await vlmService.extractPowerMeterReading('http://example.com/step7.jpg');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  // TEST 15: extractPowerMeterReading - invalid JSON response
  it('should handle malformed JSON from VLM API', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'not json' } }] }),
      text: async () => '',
    });

    const result = await vlmService.extractPowerMeterReading('http://example.com/step7.jpg');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ============================================================================
// TEST SUITE 3: ONT SERIAL EXTRACTION
// ============================================================================

describe('vlmExtractionService - ONT Serial Extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock photoFetchService
    vi.mocked(photoFetchService.fetchPhotoAsBase64).mockResolvedValue(SAMPLE_BASE64_IMAGE);

    // Mock imagePreprocessService
    vi.mocked(imagePreprocessService.preprocessImage).mockResolvedValue({
      wasPreprocessed: false,
      imageBase64: SAMPLE_BASE64_IMAGE,
    });

    vi.mocked(imagePreprocessService.optimizeForVlm).mockResolvedValue(SAMPLE_BASE64_IMAGE);

    vi.mocked(imagePreprocessService.detectBlur).mockResolvedValue({
      isBlurry: false,
      score: 0.3,
      threshold: 0.5,
      assessment: 'Clear',
    });

    // Mock barcode extraction - no barcode by default
    vi.mocked(barcodeService.extractOntSerialFromBarcode).mockResolvedValue({
      success: false,
      serial: null,
      confidence: 0,
      format: 'UNKNOWN',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TEST 16: extractOntSerialFromBack - barcode extraction success
  it('should prefer barcode extraction when available', async () => {
    // Mock successful barcode scan
    vi.mocked(barcodeService.extractOntSerialFromBarcode).mockResolvedValueOnce({
      success: true,
      serial: 'ALCLB48D1234',
      confidence: 0.99,
      format: 'CODE128',
    });

    const result = await vlmService.extractOntSerialFromBack('http://example.com/step6.jpg');

    expect(result.success).toBe(true);
    expect(result.serial).toBe('ALCLB48D1234');
    expect(result.confidence).toBe(0.99);
    expect(result.extractionMethod).toBe('barcode');
  });

  // TEST 17: extractOntSerialFromBack - falls back to VLM when no barcode
  it('should fall back to VLM when barcode extraction fails', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                found: true,
                serial: 'ALCLB48F5678',
                rawText: 'S/N: ALCLB48F5678',
                confidence: 0.92,
              }),
            },
          },
        ],
      }),
      text: async () => '',
    });

    const result = await vlmService.extractOntSerialFromBack('http://example.com/step6.jpg');

    expect(result.success).toBe(true);
    expect(result.serial).toBe('ALCLB48F5678');
    expect(result.extractionMethod).toBe('vlm');
  });

  // TEST 18: extractOntSerialFromBack - rejects invalid VLM result
  it('should reject invalid serial format from VLM', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                found: true,
                serial: 'ALHN-C397', // SSID, not serial
                rawText: 'ALHN-C397',
                confidence: 0.85,
              }),
            },
          },
        ],
      }),
      text: async () => '',
    });

    const result = await vlmService.extractOntSerialFromBack('http://example.com/step6.jpg');

    expect(result.success).toBe(false);
    expect(result.serial).toBeNull();
  });

  // TEST 19: extractOntSerialFromBack - normalizes and validates extracted serial
  it('should normalize VLM result (remove spaces, fix OCR errors)', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                found: true,
                serial: 'ALCLB4 8D 12 34', // Spaces
                rawText: 'S/N: ALCLB4 8D 12 34',
                confidence: 0.88,
              }),
            },
          },
        ],
      }),
      text: async () => '',
    });

    const result = await vlmService.extractOntSerialFromBack('http://example.com/step6.jpg');

    expect(result.success).toBe(true);
    expect(result.serial).toBe('ALCLB48D1234');
  });
});

// ============================================================================
// TEST SUITE 4: STEP 9 EXTRACTION
// ============================================================================

describe('vlmExtractionService - Step 9 Extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(photoFetchService.fetchPhotoAsBase64).mockResolvedValue(SAMPLE_BASE64_IMAGE);

    vi.mocked(imagePreprocessService.preprocessImage).mockResolvedValue({
      wasPreprocessed: false,
      imageBase64: SAMPLE_BASE64_IMAGE,
    });

    vi.mocked(imagePreprocessService.optimizeForVlm).mockResolvedValue(SAMPLE_BASE64_IMAGE);

    vi.mocked(imagePreprocessService.detectBlur).mockResolvedValue({
      isBlurry: false,
      score: 0.3,
      threshold: 0.5,
      assessment: 'Clear',
    });

    vi.mocked(barcodeService.extractOntSerialFromBarcode).mockResolvedValue({
      success: false,
      serial: null,
      confidence: 0,
      format: 'UNKNOWN',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TEST 20: extractStep9Data - extracts serial and DR number
  it('should extract ONT serial and DR number from Step 9 photo', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                greenLightsVisible: true,
                ontSerial: {
                  found: true,
                  serial: 'ALCLB477ABCD',
                  rawText: 'S/N: ALCLB477ABCD',
                  confidence: 0.94,
                },
                drNumber: {
                  found: true,
                  drNumber: 'DR1736721',
                  rawText: 'DR1736721',
                  confidence: 0.96,
                },
              }),
            },
          },
        ],
      }),
      text: async () => '',
    });

    const result = await vlmService.extractStep9Data('http://example.com/step9.jpg');

    expect(result.ontSerial.success).toBe(true);
    expect(result.ontSerial.serial).toBe('ALCLB477ABCD');
    expect(result.drNumber.success).toBe(true);
    expect(result.drNumber.drNumber).toBe('DR1736721');
    expect(result.greenLightsVisible).toBe(true);
  });

  // TEST 21: extractStep9Data - reports processing time
  it('should include processing time in result', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                greenLightsVisible: true,
                ontSerial: { found: false, serial: null, confidence: 0 },
                drNumber: { found: false, drNumber: null, confidence: 0 },
              }),
            },
          },
        ],
      }),
      text: async () => '',
    });

    const result = await vlmService.extractStep9Data('http://example.com/step9.jpg');

    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.processingTimeMs).toBe('number');
  });
});

// ============================================================================
// TEST SUITE 5: SERIAL CONFIRMATION
// ============================================================================

describe('vlmExtractionService - Serial Confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(photoFetchService.fetchPhotoAsBase64).mockResolvedValue(SAMPLE_BASE64_IMAGE);

    vi.mocked(imagePreprocessService.preprocessImage).mockResolvedValue({
      wasPreprocessed: false,
      imageBase64: SAMPLE_BASE64_IMAGE,
    });

    vi.mocked(imagePreprocessService.optimizeForVlm).mockResolvedValue(SAMPLE_BASE64_IMAGE);

    vi.mocked(imagePreprocessService.detectBlur).mockResolvedValue({
      isBlurry: false,
      score: 0.3,
      threshold: 0.5,
      assessment: 'Clear',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TEST 22: confirmSerialVisible - confirms when serial is visible
  it('should confirm serial when it is visible in photo', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                confirmed: true,
                confidence: 0.98,
                visibleText: 'ALCLB48D1234',
                alternativeSerial: null,
                details: 'Serial clearly visible on label',
              }),
            },
          },
        ],
      }),
      text: async () => '',
    });

    const result = await vlmService.confirmSerialVisible(
      'http://example.com/step6.jpg',
      'ALCLB48D1234'
    );

    expect(result.confirmed).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.expectedSerial).toBe('ALCLB48D1234');
  });

  // TEST 23: confirmSerialVisible - rejects when not found
  it('should reject confirmation when serial is not visible', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                confirmed: false,
                confidence: 0.2,
                visibleText: null,
                alternativeSerial: 'ALCLB48F5678',
                details: 'Expected serial not found, different serial visible',
              }),
            },
          },
        ],
      }),
      text: async () => '',
    });

    const result = await vlmService.confirmSerialVisible(
      'http://example.com/step6.jpg',
      'ALCLB48D1234'
    );

    expect(result.confirmed).toBe(false);
    expect(result.alternativeSerial).toBe('ALCLB48F5678');
  });

  // TEST 24: confirmSerialFromMultiplePhotos - returns best result
  it('should confirm serial from multiple photos and return best match', async () => {
    // Mock first photo - not confirmed
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  confirmed: false,
                  confidence: 0.3,
                  visibleText: null,
                  alternativeSerial: null,
                  details: 'Blurry',
                }),
              },
            },
          ],
        }),
        text: async () => '',
      })
      // Mock second photo - confirmed
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  confirmed: true,
                  confidence: 0.95,
                  visibleText: 'ALCLB48D1234',
                  alternativeSerial: null,
                  details: 'Clear',
                }),
              },
            },
          ],
        }),
        text: async () => '',
      });

    const result = await vlmService.confirmSerialFromMultiplePhotos(
      ['http://example.com/step6a.jpg', 'http://example.com/step6b.jpg'],
      'ALCLB48D1234'
    );

    expect(result.result.confirmed).toBe(true);
    expect(result.result.confidence).toBeGreaterThan(0.9);
  });
});

// ============================================================================
// TEST SUITE 6: POWER METER WITH MULTIPLE PHOTOS
// ============================================================================

describe('vlmExtractionService - Power Meter with Multiple Photos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(photoFetchService.fetchPhotoAsBase64).mockResolvedValue(SAMPLE_BASE64_IMAGE);
    vi.mocked(imagePreprocessService.preprocessImage).mockResolvedValue({
      wasPreprocessed: false,
      imageBase64: SAMPLE_BASE64_IMAGE,
    });
    vi.mocked(imagePreprocessService.optimizeForVlm).mockResolvedValue(SAMPLE_BASE64_IMAGE);
    vi.mocked(imagePreprocessService.detectBlur).mockResolvedValue({
      isBlurry: false,
      score: 0.3,
      threshold: 0.5,
      assessment: 'Clear',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TEST 25: extractPowerMeterWithMultiplePhotos - picks best result
  it('should pick best reading from multiple photos', async () => {
    // First photo fails, second photo succeeds with high confidence
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ found: false, value: null, rawText: null, confidence: 0 }) } }],
        }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ found: true, value: -22.5, rawText: '-22.5 dBm', confidence: 0.96 }) } }],
        }),
        text: async () => '',
      });

    const { result } = await vlmService.extractPowerMeterWithMultiplePhotos([
      'http://example.com/step7a.jpg',
      'http://example.com/step7b.jpg',
    ]);

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.value).toBe(-22.5);
    expect(result!.confidence).toBeGreaterThan(0.9);
  });

  // TEST 26: extractPowerMeterWithMultiplePhotos - all photos fail
  it('should return failure when all photos fail', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ found: false, value: null, rawText: null, confidence: 0 }) } }],
      }),
      text: async () => '',
    });

    const { result } = await vlmService.extractPowerMeterWithMultiplePhotos([
      'http://example.com/step7a.jpg',
      'http://example.com/step7b.jpg',
    ]);

    // result is the best PowerMeterExtraction found (not null but failed extraction)
    expect(result === null || result!.success === false).toBe(true);
  });
});

// ============================================================================
// TEST SUITE 7: ONT SERIAL WITH MULTIPLE PHOTOS
// ============================================================================

describe('vlmExtractionService - ONT Serial with Multiple Photos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(photoFetchService.fetchPhotoAsBase64).mockResolvedValue(SAMPLE_BASE64_IMAGE);
    vi.mocked(imagePreprocessService.preprocessImage).mockResolvedValue({
      wasPreprocessed: false,
      imageBase64: SAMPLE_BASE64_IMAGE,
    });
    vi.mocked(imagePreprocessService.optimizeForVlm).mockResolvedValue(SAMPLE_BASE64_IMAGE);
    vi.mocked(imagePreprocessService.detectBlur).mockResolvedValue({
      isBlurry: false,
      score: 0.3,
      threshold: 0.5,
      assessment: 'Clear',
    });
    vi.mocked(barcodeService.extractOntSerialFromBarcode).mockResolvedValue({
      success: false,
      serial: null,
      confidence: 0,
      format: 'UNKNOWN',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TEST 27: extractOntSerialWithMultiplePhotos - returns best result
  it('should extract serial from multiple photos and return best', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ found: true, serial: 'ALCLB48A1111', rawText: 'S/N: ALCLB48A1111', confidence: 0.91 }) } }],
        }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ found: true, serial: 'ALCLB48A1111', rawText: 'S/N: ALCLB48A1111', confidence: 0.97 }) } }],
        }),
        text: async () => '',
      });

    const { result } = await vlmService.extractOntSerialWithMultiplePhotos([
      'http://example.com/step6a.jpg',
      'http://example.com/step6b.jpg',
    ]);

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.serial).toBe('ALCLB48A1111');
    expect(result!.confidence).toBeGreaterThan(0.9);
  });

  // TEST 28: extractOntSerialWithMultiplePhotos - barcode preferred over VLM
  it('should prefer barcode result when barcode scan succeeds', async () => {
    vi.mocked(barcodeService.extractOntSerialFromBarcode).mockResolvedValueOnce({
      success: true,
      serial: 'ALCLB48C9999',
      confidence: 0.999,
      format: 'CODE128',
    });

    const { result } = await vlmService.extractOntSerialWithMultiplePhotos([
      'http://example.com/step6a.jpg',
    ]);

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.serial).toBe('ALCLB48C9999');
    expect(result!.extractionMethod).toBe('barcode');
  });
});

// ============================================================================
// TEST SUITE 8: UTILITY FUNCTION EDGE CASES
// ============================================================================

describe('vlmExtractionService - Utility Function Edge Cases', () => {
  // TEST 29: serialsMatch - handles empty strings
  it('should treat empty string as non-match', () => {
    expect(vlmService.serialsMatch('', 'ALCLB48D1234')).toBe(false);
    expect(vlmService.serialsMatch('ALCLB48D1234', '')).toBe(false);
  });

  // TEST 30: drNumbersMatch - handles DR prefix variations
  it('should handle various DR prefix formats', () => {
    expect(vlmService.drNumbersMatch('DR1234567', 'DR1234567')).toBe(true);
    expect(vlmService.drNumbersMatch('1234567', '1234567')).toBe(true);
  });

  // TEST 31: serialsMatch - exact match
  it('should match identical serials exactly', () => {
    expect(vlmService.serialsMatch('ALCLB48D1234', 'ALCLB48D1234')).toBe(true);
  });

  // TEST 32: drNumbersMatch - different lengths
  it('should not match DR numbers of different lengths', () => {
    expect(vlmService.drNumbersMatch('DR1234', 'DR12345')).toBe(false);
  });
});



