// tests/unit/vlm-bench/civil-pair-sets.test.ts
// The four civil sets must stay mutually disjoint. If any pair overlaps, a
// prompt tuned on one can be scored on a photo it already saw, and every
// before/after number built on these sets becomes unsafe.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const GOLDEN = path.join(__dirname, '../../../scripts/vlm-bench/datasets/golden');
const SETS = ['civil-qa', 'civil-qa-holdout', 'civil-pair', 'civil-pair-holdout'] as const;

interface Case {
  expected: { photoId?: string; reviewId?: string; step?: number; stratum?: string };
}

function load(name: string): Case[] {
  return JSON.parse(fs.readFileSync(path.join(GOLDEN, name, 'cases.json'), 'utf8')) as Case[];
}

const ids = (cases: Case[], key: 'photoId' | 'reviewId'): Set<string> =>
  new Set(cases.map((c) => c.expected[key]).filter((v): v is string => Boolean(v)));

describe('civil golden sets', () => {
  it.each(SETS)('%s exists and is non-empty', (name) => {
    expect(load(name).length).toBeGreaterThan(0);
  });

  // Every unordered pair, so a new set cannot be added without being checked
  // against all the existing ones.
  const pairs = SETS.flatMap((a, i) => SETS.slice(i + 1).map((b) => [a, b] as const));

  it.each(pairs)('%s and %s share no photo', (a, b) => {
    const overlap = [...ids(load(a), 'photoId')].filter((x) => ids(load(b), 'photoId').has(x));
    expect(overlap).toEqual([]);
  });

  // Photos from one review are the same pole, site, photographer and often the
  // same minute — seeing one is partly seeing the others.
  it.each(pairs)('%s and %s share no review', (a, b) => {
    const overlap = [...ids(load(a), 'reviewId')].filter((x) => ids(load(b), 'reviewId').has(x));
    expect(overlap).toEqual([]);
  });
});

describe('civil pair sets', () => {
  it.each(['civil-pair', 'civil-pair-holdout'])('%s holds only steps 2 and 5', (name) => {
    const steps = [...new Set(load(name).map((c) => c.expected.step))].sort();
    expect(steps).toEqual([2, 5]);
  });

  // 30 per cell. An unbalanced pair set would let a model that always answers
  // one step score well above chance, which is exactly what this pack exists
  // to rule out.
  it.each(['civil-pair', 'civil-pair-holdout'])('%s is balanced across step x stratum', (name) => {
    const cells = new Map<string, number>();
    for (const c of load(name)) {
      const k = `${c.expected.step}:${c.expected.stratum}`;
      cells.set(k, (cells.get(k) ?? 0) + 1);
    }
    expect([...cells.keys()].sort()).toEqual([
      '2:vlm_right',
      '2:vlm_wrong',
      '5:vlm_right',
      '5:vlm_wrong',
    ]);
    expect([...new Set(cells.values())]).toHaveLength(1);
  });
});
