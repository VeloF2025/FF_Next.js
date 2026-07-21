vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { describe, it, expect, vi } from 'vitest';
import { isVlmFallback, FALLBACK_RESULT } from '../worksQaVlmService';

describe('isVlmFallback', () => {
  it('is true for the FALLBACK_RESULT sentinel', () => {
    expect(isVlmFallback(FALLBACK_RESULT)).toBe(true);
    // Matches by value, not identity — a re-constructed fallback still matches.
    expect(
      isVlmFallback({ valid: false, confidence: 0, feedback: FALLBACK_RESULT.feedback }),
    ).toBe(true);
  });

  it('is false for a real invalid verdict (valid:false with a genuine critique)', () => {
    expect(
      isVlmFallback({ valid: false, confidence: 0.9, feedback: 'The photo does not show the required element.' }),
    ).toBe(false);
  });

  it('is false for a real pass', () => {
    expect(isVlmFallback({ valid: true, confidence: 0.95, feedback: 'Looks good.' })).toBe(false);
  });

  it('is false for a genuine confidence-0 verdict whose feedback differs from the sentinel', () => {
    expect(
      isVlmFallback({ valid: false, confidence: 0, feedback: 'This image is not related to any civil construction step.' }),
    ).toBe(false);
  });
});
