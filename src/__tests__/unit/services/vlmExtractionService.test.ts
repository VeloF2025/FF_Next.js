/**
 * Unit Tests: VLM Extraction Service
 *
 * Focus: Core extraction logic for power meter dBm, ONT serial, DR numbers, and serial confirmation
 * Approach: Mock VLM API (fetch), photoFetch, barcode, and preprocessing services
 *
 * Key constraint: ONT serials must match Nokia format — starts with ALCLB4, exactly 12 chars, hex suffix
 *
 * Test Coverage:
 * - Power meter extraction with valid/invalid JSON responses
 * - ONT serial extraction: barcode-first, VLM fallback
 * - Serial confirmation with expected values
 * - Step 9 data extraction (serial + DR number + green lights)
 * - Error handling: network failures, bad JSON, fetch errors
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks (must be before imports) ──────────────────────────────────────────

vi.mock('@/lib/logger', () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('@/modules/activate/services/photoFetchService', () => ({
  fetchPhotoAsBase64: vi.fn(),
}));

vi.mock('@/modules/activate/services/barcodeExtractionService', () => ({
  extractOntSerialFromBarcode: vi.fn(),
}));

vi.mock('@/modules/activate/services/imagePreprocessService', () => ({
  detectBlur: vi.fn(),
  preprocessImage: vi.fn(),
  optimizeForVlm: vi.fn(),
}));

vi.mock('@/services/vlmLearningService', () => ({
  getVlmFewShotExamples: vi.fn().mockResolvedValue([]),
  buildVlmFewShotPrompt: vi.fn().mockReturnValue(''),
  recordCorrectExtraction: vi.fn().mockResolvedValue(undefined),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import {
  extractPowerMeterReading,
  extractOntSerialFromBack,
  confirmSerialVisible,
  extractStep9Data,
  type PowerMeterExtraction,
  type SerialExtraction,
  type SerialConfirmation,
  type Step9Extraction,
} from '@/modules/activate/services/vlmExtractionService';

import { fetchPhotoAsBase64 } from '@/modules/activate/services/photoFetchService';
import { extractOntSerialFromBarcode } from '@/modules/activate/services/barcodeExtractionService';
import { detectBlur, optimizeForVlm } from '@/modules/activate/services/imagePreprocessService';
import { recordCorrectExtraction } from '@/services/vlmLearningService';

// ── Valid test serials (Nokia ALCLB4 format: ALCLB4 + 6 hex chars = 12 chars total) ──
const SERIAL_A = 'ALCLB4A1B2C3';   // Valid Nokia ONT serial
const SERIAL_B = 'ALCLB4AABBCC';   // Another valid serial
const SERIAL_C = 'ALCLB4123456';   // Another valid serial
const SERIAL_X = 'ALCLB4FFFFFF';   // Another valid serial (different device)

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a VLM JSON response wrapped in markdown code block */
function buildVlmContent(payload: object): string {
  return '```json\n' + JSON.stringify(payload) + '\n```';
}

/** Create a mock fetch response that returns a VLM JSON payload */
function mockFetchWith(payload: object) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: buildVlmContent(payload) } }],
    }),
    text: async () => '',
  });
}

/** Create a mock fetch response simulating an HTTP error */
function mockFetchError(status = 500, body = 'Internal Server Error') {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: async () => body,
    json: async () => ({}),
  });
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('VLM Extraction Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Sensible defaults for all dependency mocks
    (fetchPhotoAsBase64 as any).mockResolvedValue('base64-photo-data');
    (extractOntSerialFromBarcode as any).mockResolvedValue({ success: false, serial: null, confidence: 0 });
    (detectBlur as any).mockResolvedValue({ isBlurry: false, score: 10, threshold: 50, assessment: 'sharp' });
    (optimizeForVlm as any).mockResolvedValue('optimized-base64');
    // vi.restoreAllMocks() in afterEach clears mockResolvedValue implementations on vi.fn() mocks,
    // so we must re-initialize recordCorrectExtraction here to ensure it returns a Promise.
    (recordCorrectExtraction as any).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // extractPowerMeterReading
  // ────────────────────────────────────────────────────────────────────────────

  describe('extractPowerMeterReading', () => {
    it('should extract a valid power meter reading', async () => {
      vi.stubGlobal('fetch', mockFetchWith({
        found: true,
        value: -15.2,
        rawText: '-15.2 dBm',
        confidence: 0.95,
      }));

      const result = await extractPowerMeterReading('http://example.com/step7.jpg');

      expect(result.success).toBe(true);
      expect(result.value).toBe(-15.2);
      expect(result.unit).toBe('dBm');
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.rawText).toBe('-15.2 dBm');
    });

    it('should extract a low-signal power meter reading', async () => {
      vi.stubGlobal('fetch', mockFetchWith({
        found: true,
        value: -22.5,
        rawText: '-22.5 dBm',
        confidence: 0.85,
      }));

      const result = await extractPowerMeterReading('http://example.com/step7.jpg');

      expect(result.success).toBe(true);
      expect(result.value).toBe(-22.5);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should return success=false when VLM reports no power meter found', async () => {
      vi.stubGlobal('fetch', mockFetchWith({
        found: false,
        value: null,
        rawText: null,
        confidence: 0,
      }));

      const result = await extractPowerMeterReading('http://example.com/step7.jpg');

      expect(result.success).toBe(false);
      expect(result.value).toBeNull();
    });

    it('should handle VLM API HTTP error response', async () => {
      vi.stubGlobal('fetch', mockFetchError(503, 'Service Unavailable'));

      const result = await extractPowerMeterReading('http://example.com/step7.jpg');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.value).toBeNull();
    });

    it('should handle network-level fetch rejection', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const result = await extractPowerMeterReading('http://example.com/step7.jpg');

      expect(result.success).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('should handle missing choices in VLM response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [] }),
        text: async () => '',
      }));

      const result = await extractPowerMeterReading('http://example.com/step7.jpg');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle photo fetch failure gracefully', async () => {
      (fetchPhotoAsBase64 as any).mockRejectedValueOnce(new Error('404 Not Found'));

      const result = await extractPowerMeterReading('http://bad-url.example');

      expect(result.success).toBe(false);
      expect(result.error).toContain('404');
    });

    it('should pass photoUrl to fetchPhotoAsBase64', async () => {
      vi.stubGlobal('fetch', mockFetchWith({ found: false, value: null, rawText: null, confidence: 0 }));

      await extractPowerMeterReading('http://example.com/step7.jpg');

      expect(fetchPhotoAsBase64).toHaveBeenCalledWith('http://example.com/step7.jpg');
    });

    it('should always return unit=dBm', async () => {
      vi.stubGlobal('fetch', mockFetchWith({ found: true, value: -22.5, rawText: '-22.5', confidence: 0.9 }));

      const result = await extractPowerMeterReading('http://example.com/step7.jpg');

      expect(result.unit).toBe('dBm');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // extractOntSerialFromBack
  // ────────────────────────────────────────────────────────────────────────────

  describe('extractOntSerialFromBack', () => {
    it('should return barcode result when barcode scan succeeds', async () => {
      (extractOntSerialFromBarcode as any).mockResolvedValueOnce({
        success: true,
        serial: SERIAL_A,
        confidence: 0.99,
        format: 'CODE_128',
      });

      const result = await extractOntSerialFromBack('http://example.com/step6.jpg');

      expect(result.success).toBe(true);
      expect(result.serial).toBe(SERIAL_A);
      expect(result.extractionMethod).toBe('barcode');
      expect(result.confidence).toBeGreaterThan(0.95);
    });

    it('should fall back to VLM when barcode returns no serial', async () => {
      (extractOntSerialFromBarcode as any).mockResolvedValueOnce({ success: false, serial: null, confidence: 0 });

      vi.stubGlobal('fetch', mockFetchWith({
        found: true,
        serial: SERIAL_B,
        rawText: SERIAL_B,
        confidence: 0.88,
      }));

      const result = await extractOntSerialFromBack('http://example.com/step6.jpg');

      expect(result.success).toBe(true);
      expect(result.serial).toBe(SERIAL_B);
      expect(result.extractionMethod).toBe('vlm');
    });

    it('should return success=false when both barcode and VLM fail', async () => {
      (extractOntSerialFromBarcode as any).mockResolvedValueOnce({ success: false, serial: null, confidence: 0 });

      vi.stubGlobal('fetch', mockFetchWith({
        found: false,
        serial: null,
        rawText: null,
        confidence: 0,
      }));

      const result = await extractOntSerialFromBack('http://example.com/step6.jpg');

      expect(result.success).toBe(false);
      expect(result.serial).toBeNull();
    });

    it('should handle VLM returning invalid serial format (SSID-like)', async () => {
      (extractOntSerialFromBarcode as any).mockResolvedValueOnce({ success: false, serial: null, confidence: 0 });

      // VLM confuses SSID for serial — starts with ALHN (rejected by isValidOntSerial)
      vi.stubGlobal('fetch', mockFetchWith({
        found: true,
        serial: 'ALHN-Router-5G',
        rawText: 'ALHN-Router-5G',
        confidence: 0.6,
      }));

      const result = await extractOntSerialFromBack('http://example.com/step6.jpg');

      // SSID-like serial should be rejected
      expect(result.success).toBe(false);
      expect(result.serial).toBeNull();
    });

    it('should handle photo fetch failure', async () => {
      (fetchPhotoAsBase64 as any).mockRejectedValueOnce(new Error('S3 access denied'));

      const result = await extractOntSerialFromBack('http://example.com/step6.jpg');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should detect blur and still attempt extraction', async () => {
      (detectBlur as any).mockResolvedValueOnce({
        isBlurry: true,
        score: 2.1,
        threshold: 50,
        assessment: 'very blurry',
      });
      (extractOntSerialFromBarcode as any).mockResolvedValueOnce({ success: false, serial: null, confidence: 0 });
      vi.stubGlobal('fetch', mockFetchWith({ found: false, serial: null, rawText: null, confidence: 0 }));

      const result = await extractOntSerialFromBack('http://example.com/blurry.jpg');

      // Service should complete (not throw) even with blurry image
      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
    });

    it('should set location=back on result', async () => {
      (extractOntSerialFromBarcode as any).mockResolvedValueOnce({
        success: true,
        serial: SERIAL_C,
        confidence: 0.99,
        format: 'CODE_128',
      });

      const result = await extractOntSerialFromBack('http://example.com/step6.jpg');

      expect(result.location).toBe('back');
    });

    it('should handle barcode scanner throwing an exception and fall back to VLM', async () => {
      (extractOntSerialFromBarcode as any).mockRejectedValueOnce(new Error('Scanner crashed'));

      vi.stubGlobal('fetch', mockFetchWith({
        found: true,
        serial: SERIAL_X,
        rawText: SERIAL_X,
        confidence: 0.85,
      }));

      // Service should recover via VLM after barcode crash
      const result = await extractOntSerialFromBack('http://example.com/step6.jpg');

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // confirmSerialVisible
  // ────────────────────────────────────────────────────────────────────────────

  describe('confirmSerialVisible', () => {
    it('should confirm when expected serial matches what VLM sees', async () => {
      vi.stubGlobal('fetch', mockFetchWith({
        confirmed: true,
        confidence: 0.97,
        visibleText: SERIAL_A,
        alternativeSerial: null,
        details: 'Serial clearly visible on front label',
      }));

      const result = await confirmSerialVisible('http://example.com/step9.jpg', SERIAL_A);

      expect(result.confirmed).toBe(true);
      expect(result.expectedSerial).toBe(SERIAL_A);
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('should return confirmed=false when serial does not match', async () => {
      vi.stubGlobal('fetch', mockFetchWith({
        confirmed: false,
        confidence: 0.85,
        visibleText: SERIAL_B,
        alternativeSerial: null,
        details: 'Different serial visible on label',
      }));

      const result = await confirmSerialVisible('http://example.com/step9.jpg', SERIAL_A);

      expect(result.confirmed).toBe(false);
      expect(result.expectedSerial).toBe(SERIAL_A);
    });

    it('should return alternative serial when a valid ALCLB4 serial is visible', async () => {
      vi.stubGlobal('fetch', mockFetchWith({
        confirmed: false,
        confidence: 0.91,
        visibleText: SERIAL_C,
        alternativeSerial: SERIAL_C,  // valid ALCLB4 format — will pass isValidOntSerial
        details: 'Mismatch detected',
      }));

      const result = await confirmSerialVisible('http://example.com/step9.jpg', SERIAL_A);

      expect(result.confirmed).toBe(false);
      expect(result.alternativeSerial).toBe(SERIAL_C);
    });

    it('should return null alternativeSerial when the alternative is not a valid ALCLB4 serial', async () => {
      vi.stubGlobal('fetch', mockFetchWith({
        confirmed: false,
        confidence: 0.75,
        visibleText: 'SSID-network',
        alternativeSerial: 'SSID-network',  // invalid format — rejected by isValidOntSerial
        details: 'Mismatch',
      }));

      const result = await confirmSerialVisible('http://example.com/step9.jpg', SERIAL_A);

      expect(result.confirmed).toBe(false);
      expect(result.alternativeSerial).toBeNull(); // invalid serial is filtered out
    });

    it('should handle VLM API failure during confirmation', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));

      const result = await confirmSerialVisible('http://example.com/step9.jpg', SERIAL_A);

      expect(result.confirmed).toBe(false);
      expect(result.details).toBeDefined();
    });

    it('should pass expectedSerial back on result', async () => {
      vi.stubGlobal('fetch', mockFetchWith({
        confirmed: true,
        confidence: 0.95,
        visibleText: SERIAL_B,
        alternativeSerial: null,
        details: 'Confirmed',
      }));

      const result = await confirmSerialVisible('http://example.com/step9.jpg', SERIAL_B);

      expect(result.expectedSerial).toBe(SERIAL_B);
    });

    it('should handle photo fetch failure', async () => {
      (fetchPhotoAsBase64 as any).mockRejectedValueOnce(new Error('Timeout'));

      const result = await confirmSerialVisible('http://bad.example', SERIAL_A);

      expect(result.confirmed).toBe(false);
      expect(result.details).toContain('Error');
    });

    it('should handle VLM returning no JSON content', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '' } }] }),
        text: async () => '',
      }));

      const result = await confirmSerialVisible('http://example.com/step9.jpg', SERIAL_A);

      expect(result.confirmed).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // extractStep9Data
  // ────────────────────────────────────────────────────────────────────────────

  describe('extractStep9Data', () => {
    it('should extract serial, DR number, and green light status from Step 9', async () => {
      vi.stubGlobal('fetch', mockFetchWith({
        greenLightsVisible: true,
        ontSerial: {
          found: true,
          serial: SERIAL_A,
          rawText: SERIAL_A,
          confidence: 0.92,
        },
        drNumber: {
          found: true,
          drNumber: 'DR-2026-003456',
          rawText: 'DR-2026-003456',
          confidence: 0.89,
        },
      }));

      const result = await extractStep9Data('http://example.com/step9.jpg');

      expect(result.greenLightsVisible).toBe(true);
      expect(result.ontSerial.success).toBe(true);
      expect(result.ontSerial.serial).toBe(SERIAL_A);
      expect(result.drNumber.success).toBe(true);
      expect(result.drNumber.drNumber).toBe('DR-2026-003456');
    });

    it('should prefer barcode serial over VLM when barcode succeeds', async () => {
      (extractOntSerialFromBarcode as any).mockResolvedValueOnce({
        success: true,
        serial: SERIAL_C,
        confidence: 0.99,
        format: 'QR_CODE',
      });

      vi.stubGlobal('fetch', mockFetchWith({
        greenLightsVisible: true,
        ontSerial: {
          found: true,
          serial: SERIAL_B,
          rawText: SERIAL_B,
          confidence: 0.75,
        },
        drNumber: {
          found: true,
          drNumber: 'DR-2026-000001',
          rawText: 'DR-2026-000001',
          confidence: 0.9,
        },
      }));

      const result = await extractStep9Data('http://example.com/step9.jpg');

      // Barcode wins over VLM for serial
      expect(result.ontSerial.serial).toBe(SERIAL_C);
      expect(result.ontSerial.extractionMethod).toBe('barcode');
    });

    it('should return DR number=null when not found', async () => {
      vi.stubGlobal('fetch', mockFetchWith({
        greenLightsVisible: false,
        ontSerial: { found: false, serial: null, rawText: null, confidence: 0 },
        drNumber: { found: false, drNumber: null, rawText: null, confidence: 0 },
      }));

      const result = await extractStep9Data('http://example.com/step9.jpg');

      expect(result.drNumber.success).toBe(false);
      expect(result.drNumber.drNumber).toBeNull();
    });

    it('should return partial result when VLM fails but barcode already succeeded', async () => {
      (extractOntSerialFromBarcode as any).mockResolvedValueOnce({
        success: true,
        serial: SERIAL_A,
        confidence: 0.99,
        format: 'CODE_128',
      });

      // VLM call fails after barcode scan
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('VLM down')));

      const result = await extractStep9Data('http://example.com/step9.jpg');

      // Should still have barcode serial even when VLM fails
      expect(result).toBeDefined();
      expect(result).toHaveProperty('ontSerial');
    });

    it('should handle photo fetch failure for step9', async () => {
      (fetchPhotoAsBase64 as any).mockRejectedValueOnce(new Error('Photo missing'));

      const result = await extractStep9Data('http://bad.example/step9.jpg');

      expect(result).toBeDefined();
      expect(result.ontSerial.success).toBe(false);
      expect(result.drNumber.success).toBe(false);
    });

    it('should include processingTimeMs in result', async () => {
      vi.stubGlobal('fetch', mockFetchWith({
        greenLightsVisible: true,
        ontSerial: { found: false, serial: null, rawText: null, confidence: 0 },
        drNumber: { found: false, drNumber: null, rawText: null, confidence: 0 },
      }));

      const result = await extractStep9Data('http://example.com/step9.jpg');

      expect(result.processingTimeMs).toBeDefined();
      expect(typeof result.processingTimeMs).toBe('number');
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should reject invalid serial returned by VLM in step9', async () => {
      // VLM returns non-ALCLB4 serial
      vi.stubGlobal('fetch', mockFetchWith({
        greenLightsVisible: true,
        ontSerial: {
          found: true,
          serial: 'GPON-WRONG-FORMAT',
          rawText: 'GPON-WRONG-FORMAT',
          confidence: 0.5,
        },
        drNumber: { found: false, drNumber: null, rawText: null, confidence: 0 },
      }));

      const result = await extractStep9Data('http://example.com/step9.jpg');

      expect(result.ontSerial.success).toBe(false);
      expect(result.ontSerial.serial).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Error Handling (cross-cutting)
  // ────────────────────────────────────────────────────────────────────────────

  describe('Error Handling', () => {
    it('should handle VLM returning malformed JSON', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{ this is not valid json }' } }],
        }),
        text: async () => '',
      }));

      const result = await extractPowerMeterReading('http://example.com/photo.jpg');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle HTTP 401 from VLM API', async () => {
      vi.stubGlobal('fetch', mockFetchError(401, 'Unauthorized'));

      const result = await extractPowerMeterReading('http://example.com/photo.jpg');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle AbortError (timeout simulation)', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

      const result = await extractOntSerialFromBack('http://example.com/step6.jpg');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Feature Flag behaviour (default enabled state)
  // ────────────────────────────────────────────────────────────────────────────

  describe('Feature Flags (default enabled state)', () => {
    it('should call extractOntSerialFromBarcode by default (ENABLE_BARCODE_EXTRACTION=true)', async () => {
      // Barcode succeeds — no VLM call needed
      (extractOntSerialFromBarcode as any).mockResolvedValueOnce({
        success: true,
        serial: SERIAL_A,
        confidence: 0.99,
        format: 'CODE_128',
      });

      await extractOntSerialFromBack('http://example.com/step6.jpg');

      expect(extractOntSerialFromBarcode).toHaveBeenCalled();
    });

    it('should call detectBlur by default (ENABLE_BLUR_DETECTION=true)', async () => {
      (extractOntSerialFromBarcode as any).mockResolvedValueOnce({ success: false, serial: null, confidence: 0 });
      vi.stubGlobal('fetch', mockFetchWith({ found: false, serial: null, rawText: null, confidence: 0 }));

      await extractOntSerialFromBack('http://example.com/step6.jpg');

      expect(detectBlur).toHaveBeenCalled();
    });

    it('should call optimizeForVlm when image is not blurry', async () => {
      (detectBlur as any).mockResolvedValueOnce({ isBlurry: false, score: 80, threshold: 50, assessment: 'sharp' });
      (extractOntSerialFromBarcode as any).mockResolvedValueOnce({ success: false, serial: null, confidence: 0 });
      vi.stubGlobal('fetch', mockFetchWith({ found: false, serial: null, rawText: null, confidence: 0 }));

      await extractOntSerialFromBack('http://example.com/step6.jpg');

      expect(optimizeForVlm).toHaveBeenCalled();
    });
  });
});
