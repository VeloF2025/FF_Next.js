/**
 * validateSerialBatch — client helper for POST /my/stores/serials/validate-batch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../request', () => ({
  request: vi.fn(),
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  },
}));

import { validateSerialBatch } from '../serials';
import { request } from '../request';
const requestMock = vi.mocked(request);

describe('validateSerialBatch', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('posts the serials and returns the per-serial results', async () => {
    requestMock.mockResolvedValueOnce({
      results: [
        { serialNumber: 'ALCLB49486FF', valid: true },
        { serialNumber: 'ALCLB4948758', valid: false, errorMessage: 'Serial number not found' },
      ],
    });

    const res = await validateSerialBatch({
      serials: ['ALCLB49486FF', 'ALCLB4948758'],
      stockItemId: 'item-ont',
      sourceLocationId: 'loc-garst',
    });

    expect(requestMock).toHaveBeenCalledWith('/api/my/stores/serials/validate-batch', {
      method: 'POST',
      body: JSON.stringify({
        serials: ['ALCLB49486FF', 'ALCLB4948758'],
        stockItemId: 'item-ont',
        sourceLocationId: 'loc-garst',
        scanSource: 'manual',
      }),
    });
    expect(res.results).toHaveLength(2);
    expect(res.results[1]!.valid).toBe(false);
  });

  it('sends a null source location when none is given', async () => {
    requestMock.mockResolvedValueOnce({ results: [] });
    await validateSerialBatch({ serials: ['ALCLB49486FF'], stockItemId: 'item-ont' });
    const body = JSON.parse(
      (requestMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.sourceLocationId).toBeNull();
  });

  it('surfaces the quants warning when the server sends one', async () => {
    requestMock.mockResolvedValueOnce({
      results: [{ serialNumber: 'ALCLB49486FF', valid: true }],
      quantsWarning: { serialsInStock: 1, quantsOnHand: 0 },
    });
    const res = await validateSerialBatch({ serials: ['ALCLB49486FF'], stockItemId: 'item-ont' });
    expect(res.quantsWarning).toEqual({ serialsInStock: 1, quantsOnHand: 0 });
  });
});

describe('validateSerialBatch scan source', () => {
  it('defaults to manual when the caller says nothing', async () => {
    // Fails closed: only an explicit machine read may take in serials the
    // stock sheet has never listed, so an omission must never unlock it.
    requestMock.mockResolvedValueOnce({ results: [] });
    await validateSerialBatch({ serials: ['X'], stockItemId: 'i' });
    const body = JSON.parse((requestMock.mock.calls.at(-1)![1] as { body: string }).body);
    expect(body.scanSource).toBe('manual');
  });

  it('sends machine for a carton scan', async () => {
    requestMock.mockResolvedValueOnce({ results: [] });
    await validateSerialBatch({ serials: ['X'], stockItemId: 'i', scanSource: 'machine' });
    const body = JSON.parse((requestMock.mock.calls.at(-1)![1] as { body: string }).body);
    expect(body.scanSource).toBe('machine');
  });
});

