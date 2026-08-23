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
});
