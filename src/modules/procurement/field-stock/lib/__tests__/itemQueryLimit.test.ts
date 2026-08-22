import { describe, it, expect } from 'vitest';
import { resolveItemLimit, DEFAULT_ITEM_LIMIT, MAX_ITEM_LIMIT } from '../itemQueryLimit';

describe('resolveItemLimit', () => {
  it('defaults high enough to clear the 316 live items that the old cap of 100 truncated', () => {
    expect(DEFAULT_ITEM_LIMIT).toBeGreaterThan(316);
    expect(resolveItemLimit(undefined)).toBe(DEFAULT_ITEM_LIMIT);
  });

  it('honours an explicit limit', () => {
    expect(resolveItemLimit('25')).toBe(25);
  });

  it('caps an oversized request at the ceiling', () => {
    expect(resolveItemLimit('999999')).toBe(MAX_ITEM_LIMIT);
  });

  it.each([['0', 'zero'], ['-5', 'negative'], ['abc', 'unparseable'], ['1.5', 'fractional'], ['', 'empty']])(
    'falls back to the default for %s (%s) rather than returning nothing',
    (raw) => {
      expect(resolveItemLimit(raw)).toBe(DEFAULT_ITEM_LIMIT);
    }
  );

  it('falls back for NaN and Infinity rather than reaching SQL', () => {
    expect(resolveItemLimit('NaN')).toBe(DEFAULT_ITEM_LIMIT);
    expect(resolveItemLimit('Infinity')).toBe(DEFAULT_ITEM_LIMIT);
  });

  it('takes the first value when the query parameter repeats', () => {
    expect(resolveItemLimit(['25', '50'])).toBe(25);
  });

  it('accepts a numeric limit as well as a string', () => {
    expect(resolveItemLimit(42)).toBe(42);
  });

  it('ignores objects and null', () => {
    expect(resolveItemLimit(null)).toBe(DEFAULT_ITEM_LIMIT);
    expect(resolveItemLimit({})).toBe(DEFAULT_ITEM_LIMIT);
  });
});
