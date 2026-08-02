import { describe, expect, it } from 'vitest';
import { nextRetryAt } from '../retry';

describe('nextRetryAt', () => {
  const now = new Date('2026-08-01T07:00:00.000Z');

  it.each([
    [1, 1],
    [2, 2],
    [3, 4],
    [4, 8],
    [5, 16],
  ])('uses the bounded %i-minute delay for attempt %i', (attempt, minutes) => {
    expect(nextRetryAt(now, attempt)).toEqual(
      new Date(now.getTime() + minutes * 60_000),
    );
  });

  it('uses a longer valid Retry-After value', () => {
    expect(nextRetryAt(now, 2, 15 * 60)).toEqual(
      new Date(now.getTime() + 15 * 60_000),
    );
  });

  it('does not retry after the fifth scheduled retry or invalid attempts', () => {
    expect(nextRetryAt(now, 6)).toBeNull();
    expect(nextRetryAt(now, 0)).toBeNull();
  });
});
