import { describe, it, expect } from 'vitest';
import { nextActiveIndex, isNavKey } from '../listboxNavigation';

describe('isNavKey', () => {
  it.each(['ArrowDown', 'ArrowUp', 'Home', 'End'])('recognises %s', (k) => {
    expect(isNavKey(k)).toBe(true);
  });

  it.each(['Enter', 'Escape', 'a', 'Tab', ' '])('rejects %s', (k) => {
    expect(isNavKey(k)).toBe(false);
  });
});

describe('nextActiveIndex', () => {
  it('starts at the first option when nothing is active and the user presses down', () => {
    expect(nextActiveIndex(-1, 'ArrowDown', 5)).toBe(0);
  });

  it('starts at the last option when nothing is active and the user presses up', () => {
    expect(nextActiveIndex(-1, 'ArrowUp', 5)).toBe(4);
  });

  it('moves down one', () => {
    expect(nextActiveIndex(1, 'ArrowDown', 5)).toBe(2);
  });

  it('moves up one', () => {
    expect(nextActiveIndex(3, 'ArrowUp', 5)).toBe(2);
  });

  it('wraps past the end back to the first', () => {
    expect(nextActiveIndex(4, 'ArrowDown', 5)).toBe(0);
  });

  it('wraps before the start round to the last', () => {
    expect(nextActiveIndex(0, 'ArrowUp', 5)).toBe(4);
  });

  it('jumps to the first with Home and the last with End', () => {
    expect(nextActiveIndex(3, 'Home', 5)).toBe(0);
    expect(nextActiveIndex(1, 'End', 5)).toBe(4);
  });

  it('returns -1 for an empty list rather than a phantom index', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End'] as const) {
      expect(nextActiveIndex(-1, key, 0)).toBe(-1);
    }
  });

  it('stays on the only option in a single-item list', () => {
    expect(nextActiveIndex(0, 'ArrowDown', 1)).toBe(0);
    expect(nextActiveIndex(0, 'ArrowUp', 1)).toBe(0);
  });
});
