// tests/unit/vlm-bench/harvest-sample.test.ts
import { describe, it, expect } from 'vitest';
import { stratifiedSample, type Candidate } from '../../../scripts/vlm-bench/harvest/sample';

const pool = (n: number, stratum: Candidate['stratum'], prefix: string): Candidate[] =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}-${i}`, stratum }));

const candidates = [...pool(50, 'vlm_wrong', 'w'), ...pool(500, 'vlm_right', 'r')];

describe('stratifiedSample', () => {
  it('returns the requested count from each stratum', () => {
    const picked = stratifiedSample(candidates, 'v1', { vlm_wrong: 40, vlm_right: 40 });
    expect(picked.filter((c) => c.stratum === 'vlm_wrong')).toHaveLength(40);
    expect(picked.filter((c) => c.stratum === 'vlm_right')).toHaveLength(40);
  });

  it('is deterministic for a given seed', () => {
    const a = stratifiedSample(candidates, 'v1', { vlm_wrong: 40, vlm_right: 40 });
    const b = stratifiedSample(candidates, 'v1', { vlm_wrong: 40, vlm_right: 40 });
    expect(a.map((c) => c.key)).toEqual(b.map((c) => c.key));
  });

  it('is stable when new rows land, so a re-harvest is not a new dataset', () => {
    const before = stratifiedSample(candidates, 'v1', { vlm_wrong: 40, vlm_right: 40 });
    const grown = [...candidates, ...pool(200, 'vlm_right', 'new')];
    const after = stratifiedSample(grown, 'v1', { vlm_wrong: 40, vlm_right: 40 });
    // Selection is by hash of the key, so pre-existing picks survive new arrivals
    // unless a new key hashes lower. Requiring a large overlap (not equality)
    // states that honestly rather than pretending growth is invisible.
    const overlap = after.filter((c) => before.some((b) => b.key === c.key)).length;
    expect(overlap).toBeGreaterThan(60);
  });

  it('does not depend on the order rows come back from the DB', () => {
    const a = stratifiedSample(candidates, 'v1', { vlm_wrong: 40, vlm_right: 40 });
    const b = stratifiedSample([...candidates].reverse(), 'v1', { vlm_wrong: 40, vlm_right: 40 });
    expect(new Set(a.map((c) => c.key))).toEqual(new Set(b.map((c) => c.key)));
  });

  it('gives a different sample for a different seed', () => {
    const a = stratifiedSample(candidates, 'v1', { vlm_wrong: 40, vlm_right: 40 });
    const b = stratifiedSample(candidates, 'v2', { vlm_wrong: 40, vlm_right: 40 });
    expect(a.map((c) => c.key)).not.toEqual(b.map((c) => c.key));
  });

  it('splits a stratum evenly across subgroups instead of letting the big pool win', () => {
    // Front corrections outnumber back ~2:1, so an unbalanced draw would
    // under-test the back label — where the two-serial failure actually lives.
    const mixed: Candidate[] = [
      ...pool(10, 'vlm_wrong', 'b').map((c) => ({ ...c, subgroup: 'back' })),
      ...pool(200, 'vlm_wrong', 'f').map((c) => ({ ...c, subgroup: 'front' })),
      ...pool(100, 'vlm_right', 'r').map((c) => ({ ...c, subgroup: 'back' })),
    ];
    const picked = stratifiedSample(mixed, 'v1', { vlm_wrong: 10, vlm_right: 4 });
    const wrong = picked.filter((c) => c.stratum === 'vlm_wrong');
    expect(wrong.filter((c) => c.subgroup === 'back')).toHaveLength(5);
    expect(wrong.filter((c) => c.subgroup === 'front')).toHaveLength(5);
  });

  it('throws when one subgroup cannot fill its share, rather than topping up from the other', () => {
    const mixed: Candidate[] = [
      ...pool(2, 'vlm_wrong', 'b').map((c) => ({ ...c, subgroup: 'back' })),
      ...pool(200, 'vlm_wrong', 'f').map((c) => ({ ...c, subgroup: 'front' })),
      ...pool(100, 'vlm_right', 'r').map((c) => ({ ...c, subgroup: 'back' })),
    ];
    expect(() => stratifiedSample(mixed, 'v1', { vlm_wrong: 40, vlm_right: 4 })).toThrow(
      /vlm_wrong\/back: only 2 candidates, need 20/,
    );
  });

  it('splits an odd quota deterministically rather than dropping the remainder', () => {
    const mixed: Candidate[] = [
      ...pool(10, 'vlm_wrong', 'b').map((c) => ({ ...c, subgroup: 'back' })),
      ...pool(10, 'vlm_wrong', 'f').map((c) => ({ ...c, subgroup: 'front' })),
      ...pool(10, 'vlm_right', 'r').map((c) => ({ ...c, subgroup: 'back' })),
    ];
    const picked = stratifiedSample(mixed, 'v1', { vlm_wrong: 5, vlm_right: 1 });
    expect(picked.filter((c) => c.stratum === 'vlm_wrong')).toHaveLength(5);
  });

  it('throws rather than silently returning a short, skewed stratum', () => {
    // Quietly returning 12 hard cases instead of 40 would make the set look
    // balanced in the manifest while the score came mostly from easy ones.
    expect(() => stratifiedSample(candidates, 'v1', { vlm_wrong: 400, vlm_right: 40 })).toThrow(
      /only 50 candidates, need 400/,
    );
  });
});
