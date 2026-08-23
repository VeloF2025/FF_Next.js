/**
 * usePickings.processPicking error surfacing.
 *
 * Regression: the hook threw `new Error(data.error)` where `data.error` is the
 * apiResponse object `{ code, message, details }`, so a refused transfer showed
 * the user the literal string "[object Object]" (Lizelle, 2026-08-23) instead of
 * the stock shortfall that actually blocked it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePickings } from '../usePickings';

const JSON_HEADERS = { get: (h: string) => (h === 'content-type' ? 'application/json' : null) };

const INSUFFICIENT_STOCK_BODY = {
  success: false,
  error: {
    code: 'VALIDATION_ERROR',
    message: 'Validation failed',
    details: {
      '9ac537f0-695f-48d0-b1cf-34b02092902e':
        'Insufficient stock of SPLIT-BF-1-16 at DC-KLM-01: required 140, available 116',
    },
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('usePickings processPicking', () => {
  it('throws the stock shortfall, not "[object Object]"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        headers: JSON_HEADERS,
        json: async () => INSUFFICIENT_STOCK_BODY,
      }),
    );

    const { result } = renderHook(() => usePickings({ autoFetch: false }));

    await expect(result.current.processPicking('picking-1')).rejects.toThrow(
      /required 140, available 116/,
    );
    await expect(result.current.processPicking('picking-1')).rejects.not.toThrow(
      /\[object Object\]/,
    );
  });

  it('never surfaces the holder UUID from a holder_blocked conflict', async () => {
    const holderId = '3f2a91c4-7b1e-4a0d-9c55-2e8d6f0a1b33';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        headers: JSON_HEADERS,
        json: async () => ({
          success: false,
          error: {
            code: 'CONFLICT',
            message: 'holder_blocked',
            details: { holderId, blockedReason: 'Aged unaccounted stock over threshold' },
          },
        }),
      }),
    );

    const { result } = renderHook(() => usePickings({ autoFetch: false }));

    await expect(result.current.processPicking('picking-1')).rejects.toThrow('holder_blocked');
    await expect(result.current.processPicking('picking-1')).rejects.not.toThrow(
      new RegExp(holderId),
    );
  });

  it('gives a readable message when the server returns an HTML error page', async () => {
    // A route that crashes at module load never reaches its try/catch, so Next
    // serves HTML. response.json() on that throws "Unexpected token '<'" — which
    // is what the banner used to show.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: { get: (h: string) => (h === 'content-type' ? 'text/html; charset=utf-8' : null) },
        json: async () => {
          throw new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON");
        },
      }),
    );

    const { result } = renderHook(() => usePickings({ autoFetch: false }));

    await expect(result.current.processPicking('picking-1')).rejects.toThrow(
      /server is temporarily unavailable/i,
    );
    await expect(result.current.processPicking('picking-1')).rejects.not.toThrow(/Unexpected token/);
  });
});
