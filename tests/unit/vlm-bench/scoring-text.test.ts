import { describe, it, expect } from 'vitest';
import { normalizeExact, charErrorRate } from '../../../scripts/vlm-bench/scoring/text';

describe('normalizeExact', () => {
  it('uppercases, strips spaces/punctuation', () => {
    expect(normalizeExact(' alclb-491 baa2 ')).toBe('ALCLB491BAA2');
  });
});

describe('charErrorRate', () => {
  it('is 0 for identical strings', () => {
    expect(charErrorRate('ABC123', 'ABC123')).toBe(0);
  });
  it('counts a single substitution (O↔0)', () => {
    expect(charErrorRate('ABC0EF', 'ABCOEF')).toBeCloseTo(1 / 6, 5);
  });
  it('counts a dropped char', () => {
    expect(charErrorRate('ABCDEF', 'ABCDE')).toBeCloseTo(1 / 6, 5);
  });
});
