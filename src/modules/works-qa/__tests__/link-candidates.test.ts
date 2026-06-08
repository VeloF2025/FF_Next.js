import { describe, it, expect } from 'vitest';
import { getLinkCandidates } from '../utils/link-candidates';
import type { PoleQaPhoto } from '../types/works-qa.types';

// Minimal pole with only the columns the helper reads; cast through unknown so
// we don't have to spell out all 30+ fields.
function pole(over: Record<string, unknown>): PoleQaPhoto {
  return over as unknown as PoleQaPhoto;
}

describe('getLinkCandidates', () => {
  it('returns same-discipline slots that hold a photo, excluding the target', () => {
    const p = pole({
      civil_step_01_key: 'k1',
      civil_step_03_key: 'k3', // depth
      civil_step_04_key: null, // end-plates (target, empty)
      optical_dome_01_key: 'dome-k', // different discipline — must NOT appear
    });
    const candidates = getLinkCandidates(p, 'civil_04');
    const keys = candidates.map(c => c.slotKey).sort();
    expect(keys).toEqual(['civil_01', 'civil_03']);
    expect(candidates.find(c => c.slotKey === 'civil_03')?.photoKey).toBe('k3');
  });

  it('excludes the target slot even when it already holds a photo', () => {
    const p = pole({ civil_step_03_key: 'k3', civil_step_04_key: 'wrong' });
    const candidates = getLinkCandidates(p, 'civil_04');
    expect(candidates.map(c => c.slotKey)).toEqual(['civil_03']);
  });

  it('never crosses disciplines (dome target sees only dome photos)', () => {
    const p = pole({
      civil_step_01_key: 'civilk',
      optical_dome_01_key: 'd1',
      optical_dome_03_key: 'd3',
    });
    const candidates = getLinkCandidates(p, 'dome_02');
    expect(candidates.map(c => c.slotKey).sort()).toEqual(['dome_01', 'dome_03']);
  });

  it('returns empty for an unknown target slot', () => {
    expect(getLinkCandidates(pole({ civil_step_01_key: 'k' }), 'nope')).toEqual([]);
  });

  it('returns empty when no same-discipline photos exist', () => {
    expect(getLinkCandidates(pole({ optical_dome_01_key: 'd' }), 'civil_04')).toEqual([]);
  });
});
