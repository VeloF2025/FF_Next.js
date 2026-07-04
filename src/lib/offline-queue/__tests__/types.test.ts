import { describe, expect, it } from 'vitest';
import { QueueFullError } from '../types';

describe('QueueFullError', () => {
  it('is an Error with a typed name and the size in the message', () => {
    const err = new QueueFullError(50);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('QueueFullError');
    expect(err.message).toContain('50');
  });
});
