import { describe, it, expect } from 'vitest';
import { generateRequestId } from './requestId';

describe('generateRequestId', () => {
  it('returns a non-empty string', () => {
    const id = generateRequestId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('returns different values on successive calls', () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    expect(id1).not.toBe(id2);
  });
});
