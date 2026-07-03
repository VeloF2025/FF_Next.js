import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ optimizeForVlm: vi.fn(), barcode: vi.fn(), fetchFn: vi.fn() }));

vi.mock('@/lib/logger', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/vlmGallery', () => ({ loadGalleryExamples: vi.fn() }));
vi.mock('@/modules/activate/services/imagePreprocessService', () => ({ optimizeForVlm: h.optimizeForVlm }));
vi.mock('@/modules/activate/services/enhancedBarcodeService', () => ({ extractOntSerialEnhanced: h.barcode }));
vi.mock('@/modules/sitecam/lib/appealStepCriteria', () => ({
  buildAppealPhotoContent: () => [], APPEAL_PHOTO_JSON_SHAPE: '{}',
}));

import { evaluateAppeal } from '../appealsVlmService';

function mockVlm(content: string) {
  h.fetchFn.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
}

const base = {
  jobType: 'activations' as const,
  stepNumber: 8,
  photoBase64: 'RAW',
  appealText: 'scanner mis-read, serial on device is correct',
  serialScanned: 'ALCLB1234567',
  serialExpected: 'ALCLB9999999',
};

beforeEach(() => {
  vi.clearAllMocks();
  h.optimizeForVlm.mockResolvedValue('small-b64');
  vi.stubGlobal('fetch', h.fetchFn);
});

describe('evaluateAppeal — serial mode', () => {
  it('approves when the barcode-read serial matches the scanned value', async () => {
    h.barcode.mockResolvedValue({ success: true, serial: 'ALCLB1234567', confidence: 0.99, method: 'barcode', format: null, processingTimeMs: 5 });
    const r = await evaluateAppeal(base);
    expect(r.recommendation).toBe('approve');
    expect(r.serialRead).toBe('ALCLB1234567');
    expect(r.confidence).toBeGreaterThan(0.9);
    expect(h.fetchFn).not.toHaveBeenCalled(); // barcode hit → no VLM OCR
  });

  it('denies when the photo shows a different serial than the tech scanned', async () => {
    h.barcode.mockResolvedValue({ success: true, serial: 'ALCLB7654321', confidence: 0.99, method: 'barcode', format: null, processingTimeMs: 5 });
    const r = await evaluateAppeal(base);
    expect(r.recommendation).toBe('deny');
    expect(r.serialRead).toBe('ALCLB7654321');
  });

  it('falls back to VLM OCR when the barcode scan fails', async () => {
    h.barcode.mockResolvedValue({ success: false, serial: null, confidence: 0, method: 'none', format: null, processingTimeMs: 5 });
    mockVlm('{"serial":"ALCLB1234567"}');
    const r = await evaluateAppeal(base);
    expect(r.recommendation).toBe('approve');
    expect(r.serialRead).toBe('ALCLB1234567');
    expect(r.confidence).toBeLessThan(0.9); // OCR is lower-confidence than a barcode read
  });

  it('is uncertain + unreadable_image when neither barcode nor OCR can read a serial', async () => {
    h.barcode.mockResolvedValue({ success: false, serial: null, confidence: 0, method: 'none', format: null, processingTimeMs: 5 });
    mockVlm('{"serial":null}');
    const r = await evaluateAppeal(base);
    expect(r.recommendation).toBe('uncertain');
    expect(r.skipReason).toBe('unreadable_image');
    expect(r.serialRead).toBeNull();
  });

  it('treats a barcode-service throw as a failed read and falls back to OCR', async () => {
    h.barcode.mockRejectedValue(new Error('wasm boom'));
    mockVlm('{"serial":"ALCLB1234567"}');
    const r = await evaluateAppeal(base);
    expect(r.serialRead).toBe('ALCLB1234567');
  });
});
