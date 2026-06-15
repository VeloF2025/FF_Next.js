import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { decideCrossRefStatus, crossReferenceSerial } from '../serialCrossRef';

describe('decideCrossRefStatus', () => {
  it('stays pending when no reference serial exists', () => {
    expect(decideCrossRefStatus('ALCLB1234567', null).status).toBe('pending');
    expect(decideCrossRefStatus('ALCLB1234567', undefined).status).toBe('pending');
    expect(decideCrossRefStatus('ALCLB1234567', '  ').status).toBe('pending');
  });

  it('verifies an exact match (case-insensitive)', () => {
    const r = decideCrossRefStatus('ALCLB1234567', 'alclb1234567');
    expect(r.status).toBe('verified');
    expect(r.expectedSerial).toBe('ALCLB1234567');
  });

  it('verifies within 2 edits (scan noise tolerance)', () => {
    expect(decideCrossRefStatus('ALCLB1234567', 'ALCLB1234561').status).toBe('verified'); // 1 edit
    expect(decideCrossRefStatus('ALCLB1234567', 'ALCLB1234500').status).toBe('verified'); // 2 edits
  });

  it('flags 3+ edits as mismatch (tolerance boundary)', () => {
    expect(decideCrossRefStatus('ALCLB1234567', 'ALCLB1234000').status).toBe('mismatch'); // 3 edits
    expect(decideCrossRefStatus('ALCLB1234567', 'ALCLB9999999').status).toBe('mismatch');
  });
});

describe('crossReferenceSerial', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('verifies against the 1Map ont_barcode for ONT scans', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ont_barcode: 'ALCLB1234567', ups_serial: 'GU18W12V001' }),
    });
    const r = await crossReferenceSerial('DR123', 'ont', 'ALCLB1234567');
    expect(r.status).toBe('verified');
  });

  it('compares UPS scans against ups_serial, not ont_barcode', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ont_barcode: 'ALCLB1234567', ups_serial: 'GU18W12V001' }),
    });
    const r = await crossReferenceSerial('DR123', 'ups', 'GU99X99X999');
    expect(r.status).toBe('mismatch');
    expect(r.expectedSerial).toBe('GU18W12V001');
  });

  it('stays pending when the reference field is present but not a string', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ont_barcode: 1234567, ups_serial: null }),
    });
    const r = await crossReferenceSerial('DR123', 'ont', 'ALCLB1234567');
    expect(r.status).toBe('pending');
    expect(r.expectedSerial).toBeNull();
  });

  it('stays pending when the DR has no 1Map record', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const r = await crossReferenceSerial('DR123', 'ont', 'ALCLB1234567');
    expect(r.status).toBe('pending');
  });

  it('stays pending (never throws) when the lookup fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const r = await crossReferenceSerial('DR123', 'ont', 'ALCLB1234567');
    expect(r.status).toBe('pending');
  });
});
