import { describe, it, expect } from 'vitest';
import { dropNumberCandidates, toDrSiteId } from '../[id]';

describe('dropNumberCandidates', () => {
  it('matches DR-prefixed drops (the ~99.8% case) from a prefixed input', () => {
    // Regression: input "DR1854086" must produce a candidate that equals the
    // stored drops.drop_number "DR1854086" — the old code stripped the prefix
    // and queried bare "1854086", which never matched prefixed rows.
    expect(dropNumberCandidates('DR1854086')).toContain('DR1854086');
  });

  it('normalises dashed and bare inputs to the same candidate set', () => {
    expect(dropNumberCandidates('DR-1854086')).toEqual(['DR1854086', '1854086']);
    expect(dropNumberCandidates('1854086')).toEqual(['DR1854086', '1854086']);
    expect(dropNumberCandidates('DR1854086')).toEqual(['DR1854086', '1854086']);
  });

  it('still matches the rare bare-numeric drops (e.g. "50")', () => {
    expect(dropNumberCandidates('DR-50')).toEqual(['DR50', '50']);
    expect(dropNumberCandidates('50')).toContain('50');
  });
});

describe('toDrSiteId', () => {
  it('leaves an already DR-prefixed value unchanged', () => {
    expect(toDrSiteId('DR1854086')).toBe('DR1854086');
  });

  it('prefixes a bare-numeric drop so it matches the DR-prefixed review table', () => {
    expect(toDrSiteId('50')).toBe('DR50');
  });
});
