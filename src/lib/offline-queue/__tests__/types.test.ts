import { describe, expect, it } from 'vitest';
import { QueueFullError, QuotaExceededError } from '../types';

describe('QueueFullError', () => {
  it('is an Error with a typed name and the size in the message', () => {
    const err = new QueueFullError(50);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('QueueFullError');
    expect(err.message).toContain('50');
  });
});

describe('QuotaExceededError', () => {
  it('is an Error with a typed name and current/add/budget bytes in the message', () => {
    const err = new QuotaExceededError(30_000_000, 500_000, 40_000_000);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('QuotaExceededError');
    // The message must carry the three raw byte figures so a log/dropped-row
    // record is self-explanatory without re-deriving them.
    expect(err.message).toContain('30000000');
    expect(err.message).toContain('500000');
    expect(err.message).toContain('40000000');
  });

  it('exposes current/add/budget as numeric fields for the UI to render copy from', () => {
    const err = new QuotaExceededError(30_000_000, 500_000, 40_000_000);
    expect(err.currentBytes).toBe(30_000_000);
    expect(err.addBytes).toBe(500_000);
    expect(err.budgetBytes).toBe(40_000_000);
  });
});
