import { describe, it, expect } from 'vitest';
import { normalizeExact, charErrorRate } from '../../../scripts/vlm-bench/scoring/text';

describe('normalizeExact', () => {
  it('uppercases, strips spaces/punctuation', () => {
    expect(normalizeExact(' alclb-491 baa2 ')).toBe('ALCLB491BAA2');
  });
  it('returns empty string for empty input', () => {
    expect(normalizeExact('')).toBe('');
  });
  it('returns empty string for null/undefined input (guard)', () => {
    expect(normalizeExact(null as unknown as string)).toBe('');
    expect(normalizeExact(undefined as unknown as string)).toBe('');
  });
  it('is idempotent on already-normalised input', () => {
    expect(normalizeExact('ALCLB491BAA2')).toBe('ALCLB491BAA2');
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
  it('is 1 when actual is empty but expected is not (blank VLM response)', () => {
    expect(charErrorRate('ABCDEF', '')).toBe(1);
  });
  it('is 0 when both are empty', () => {
    expect(charErrorRate('', '')).toBe(0);
  });
});
