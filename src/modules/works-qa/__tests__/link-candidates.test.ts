import { describe, it, expect } from 'vitest';
import { getLinkCandidates } from '../utils/link-candidates';
import type { PoleQaPhoto } from '../types/works-qa.types';

// Minimal pole with only the columns the helper reads; cast through unknown so
// we don't have to spell out all 30+ fields.
function pole(over: Record<string, unknown>): PoleQaPhoto {
  return over as unknown as PoleQaPhoto;
}

describe('getLinkCandidates', () => {
  it('returns every photo-holding slot, excluding the target — across disciplines', () => {
    const p = pole({
      civil_step_01_key: 'k1',
      civil_step_03_key: 'k3', // depth
      civil_step_04_key: null, // end-plates (target, empty)
      optical_dome_01_key: 'dome-k', // different discipline — now INCLUDED
    });
    const candidates = getLinkCandidates(p, 'civil_04');
    const keys = candidates.map(c => c.slotKey).sort();
    expect(keys).toEqual(['civil_01', 'civil_03', 'dome_01']);
    expect(candidates.find(c => c.slotKey === 'civil_03')?.photoKey).toBe('k3');
  });

  it('tags each candidate with its discipline + human label', () => {
    const p = pole({ civil_step_01_key: 'civilk', optical_dome_01_key: 'd1', main_joint_11_key: 'm1' });
    const candidates = getLinkCandidates(p, 'dome_02');
    const byKey = Object.fromEntries(candidates.map(c => [c.slotKey, c]));
    expect(byKey['civil_01']).toMatchObject({ discipline: 'civil', disciplineLabel: 'Civil' });
    expect(byKey['main_joint_11']).toMatchObject({ discipline: 'main_joint', disciplineLabel: 'Main Joint' });
  });

  it('excludes the target slot even when it already holds a photo', () => {
    const p = pole({ civil_step_03_key: 'k3', civil_step_04_key: 'wrong' });
    const candidates = getLinkCandidates(p, 'civil_04');
    expect(candidates.map(c => c.slotKey)).toEqual(['civil_03']);
  });

  it('lets a dome target reuse photos from other disciplines (dome + main joint reuse)', () => {
    const p = pole({
      civil_step_01_key: 'civilk',
      optical_dome_01_key: 'd1',
      main_joint_11_key: 'm1',
    });
    const candidates = getLinkCandidates(p, 'dome_02');
    expect(candidates.map(c => c.slotKey).sort()).toEqual(['civil_01', 'dome_01', 'main_joint_11']);
  });

  it('returns empty for an unknown target slot', () => {
    expect(getLinkCandidates(pole({ civil_step_01_key: 'k' }), 'nope')).toEqual([]);
  });

  it('returns empty when no other slot holds a photo', () => {
    expect(getLinkCandidates(pole({ civil_step_04_key: 'only-target' }), 'civil_04')).toEqual([]);
  });
});
