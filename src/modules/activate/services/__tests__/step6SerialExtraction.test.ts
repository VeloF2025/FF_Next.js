import { describe, it, expect, vi } from 'vitest';
import { extractStep6Serials } from '../step6SerialExtraction';

describe('extractStep6Serials', () => {
  it('persists both serials the extractor returns and returns them', async () => {
    const extract = vi.fn().mockResolvedValue({
      success: true, ontSerial: 'ALCLB480E6E8', upsSerial: 'GU18W12V1234567890',
      confidence: 0.9, ontConfidence: 0.98, upsConfidence: 0.8, ontFromBarcode: true, processingTimeMs: 10,
    });
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const out = await extractStep6Serials('DR123', 'https://x/step-6.jpg', { extract, query });
    expect(out).toEqual({ ont: 'ALCLB480E6E8', ups: 'GU18W12V1234567890' });
    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/vlm_ont_serial_step6/);
    expect(sql).toMatch(/vlm_ups_serial_step6/);
    expect(params).toEqual(['DR123', 'ALCLB480E6E8', 'GU18W12V1234567890']);
  });

  it('passes through nulls (a partial read) without throwing', async () => {
    const extract = vi.fn().mockResolvedValue({
      success: true, ontSerial: 'ALCLB480E6E8', upsSerial: null,
      confidence: 0.9, ontConfidence: 0.98, upsConfidence: 0, ontFromBarcode: true, processingTimeMs: 10,
    });
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const out = await extractStep6Serials('DR123', 'https://x/step-6.jpg', { extract, query });
    expect(out).toEqual({ ont: 'ALCLB480E6E8', ups: null });
    expect(query.mock.calls[0][1]).toEqual(['DR123', 'ALCLB480E6E8', null]);
  });

  it('never throws when the extractor fails — returns nulls, no write', async () => {
    const extract = vi.fn().mockRejectedValue(new Error('VLM down'));
    const query = vi.fn();
    const out = await extractStep6Serials('DR123', 'https://x/step-6.jpg', { extract, query });
    expect(out).toEqual({ ont: null, ups: null });
    expect(query).not.toHaveBeenCalled();
  });

  // Guards the clobber-prevention invariant: a null read must never overwrite a
  // serial an earlier pass captured. Removing either COALESCE fails this test.
  it('writes both columns through COALESCE so a null read cannot clobber a prior serial', async () => {
    const extract = vi.fn().mockResolvedValue({
      success: true, ontSerial: null, upsSerial: null,
      confidence: 0, ontConfidence: 0, upsConfidence: 0, ontFromBarcode: false, processingTimeMs: 10,
    });
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await extractStep6Serials('DR123', 'https://x/step-6.jpg', { extract, query });
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/vlm_ont_serial_step6\s*=\s*COALESCE\(\s*\$2\s*,\s*vlm_ont_serial_step6\s*\)/);
    expect(sql).toMatch(/vlm_ups_serial_step6\s*=\s*COALESCE\(\s*\$3\s*,\s*vlm_ups_serial_step6\s*\)/);
  });

  // The only production-reachable failure of the "never throws" contract is a DB
  // write error (the VLM extractor resolves rather than rejects). It must not throw
  // AND must not discard the serials it already read.
  it('preserves the read (does not return nulls) and never throws when the DB write fails', async () => {
    const extract = vi.fn().mockResolvedValue({
      success: true, ontSerial: 'ALCLB480E6E8', upsSerial: 'GU18W12V1234567890',
      confidence: 0.9, ontConfidence: 0.98, upsConfidence: 0.8, ontFromBarcode: true, processingTimeMs: 10,
    });
    const query = vi.fn().mockRejectedValue(new Error('pg pool exhausted'));
    const out = await extractStep6Serials('DR123', 'https://x/step-6.jpg', { extract, query });
    expect(out).toEqual({ ont: 'ALCLB480E6E8', ups: 'GU18W12V1234567890' });
    expect(query).toHaveBeenCalledOnce();
  });
});
