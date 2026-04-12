import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/activate/services/vlmClient', () => ({
  callVlmExtraction: vi.fn(),
  preprocessForVlm: vi.fn(async (b64: string) => ({ base64: b64 })),
  vlmLogger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  ENABLE_BARCODE_EXTRACTION: false,
}));

vi.mock('@/modules/activate/services/photoFetchService', () => ({
  fetchPhotoAsBase64: vi.fn(async () => 'base64data'),
}));

vi.mock('@/modules/activate/services/barcodeExtractionService', () => ({
  extractOntSerialFromBarcode: vi.fn(),
}));

vi.mock('@/services/vlmLearningService', () => ({
  getVlmFewShotExamples: vi.fn(async () => []),
  buildVlmFewShotPrompt: vi.fn(() => ''),
}));

import { callVlmExtraction } from '@/modules/activate/services/vlmClient';
import { extractUpsSerialRecheck, extractOntSerialRecheck } from '@/modules/activate/services/waPhotoExtraction';

describe('extractUpsSerialRecheck', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns serial and confidence when VLM succeeds above threshold', async () => {
    vi.mocked(callVlmExtraction).mockResolvedValueOnce({
      success: true,
      data: { upsSerial: { found: true, serial: 'GU18W12V2511020289', confidence: 0.92 } },
    });

    const result = await extractUpsSerialRecheck('http://example.com/photo.jpg');
    expect(result.serial).toBe('GU18W12V2511020289');
    expect(result.confidence).toBeCloseTo(0.92);
    expect(result.success).toBe(true);
  });

  it('returns null serial when VLM confidence is below floor', async () => {
    vi.mocked(callVlmExtraction).mockResolvedValueOnce({
      success: true,
      data: { upsSerial: { found: true, serial: 'GU18W12V2511020289', confidence: 0.5 } },
    });

    const result = await extractUpsSerialRecheck('http://example.com/photo.jpg');
    expect(result.serial).toBeNull();
    expect(result.success).toBe(false);
  });

  it('returns success=false when VLM fails', async () => {
    vi.mocked(callVlmExtraction).mockResolvedValueOnce({
      success: false,
      data: null,
      error: 'VLM error',
    });

    const result = await extractUpsSerialRecheck('http://example.com/photo.jpg');
    expect(result.success).toBe(false);
    expect(result.serial).toBeNull();
  });
});

describe('extractOntSerialRecheck', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns serial when VLM reads valid ONT serial', async () => {
    vi.mocked(callVlmExtraction).mockResolvedValueOnce({
      success: true,
      data: { ontSerial: { found: true, serial: 'ALCLB48DDC33', confidence: 0.9 } },
    });

    const result = await extractOntSerialRecheck('http://example.com/photo.jpg');
    expect(result.serial).toBe('ALCLB48DDC33');
    expect(result.success).toBe(true);
  });
});
