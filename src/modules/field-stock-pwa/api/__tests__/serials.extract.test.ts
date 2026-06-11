/**
 * extractSerialFromPhoto — photo→serial fallback API helper.
 *
 * Cases:
 *  (a) success response maps through as-is
 *  (b) {success:false} → throws ApiError with server message
 *  (c) non-ok HTTP status → throws ApiError
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { extractSerialFromPhoto } from '../serials';
import { ApiError } from '../request';

function makeBlob(): Blob {
  return new Blob(['fake-jpeg'], { type: 'image/jpeg' });
}

function makeFetchResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('extractSerialFromPhoto', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('(a) success response maps through', async () => {
    const result = {
      serial: 'ALCLB4DEADBEEF',
      family: 'ont' as const,
      method: 'barcode' as const,
      confidence: 0.99,
      photoUrl: '/storage/serials/proof.jpg',
    };
    global.fetch = vi.fn().mockResolvedValue(
      makeFetchResponse(200, { success: true, data: result })
    );

    const out = await extractSerialFromPhoto(makeBlob());

    expect(out).toEqual(result);
    expect(global.fetch).toHaveBeenCalledOnce();
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/my/stores/serials/extract');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('(b) {success:false} throws ApiError with server message', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeFetchResponse(422, {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Photo too small' },
      })
    );

    await expect(extractSerialFromPhoto(makeBlob())).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ApiError &&
        err.message === 'Photo too small' &&
        err.status === 422 &&
        err.code === 'VALIDATION_ERROR'
    );
  });

  it('(c) non-ok status without success field throws ApiError', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeFetchResponse(500, { success: false, error: {} })
    );

    await expect(extractSerialFromPhoto(makeBlob())).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ApiError &&
        err.status === 500 &&
        err.message.includes('500')
    );
  });
});
