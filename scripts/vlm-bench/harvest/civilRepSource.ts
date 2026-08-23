// scripts/vlm-bench/harvest/civilRepSource.ts
// Representative draw for civil: the population's own wrong/right ratio, not a
// forced 50/50.
//
// Every other civil pack is a comparison instrument — half the cases were
// picked BECAUSE a human corrected them, which makes the score deliberately
// harsher than the real workload and useless as an accuracy figure. This pack
// exists to answer a different question: how often is the classifier right on
// the photos it actually sees? That decides whether a pack is worth tuning at
// all.
//
// Read the caveat before quoting the number: "no correction" is not the same as
// "verified correct" — a reviewer who never looked closely leaves no
// correction, so this OVERSTATES accuracy. It is an upper bound on how good the
// classifier is, and the corrected share (~29.6% of labelled civil photos) is a
// lower bound on how often it is wrong.
import * as fs from 'fs';
import * as path from 'path';
import { civilCandidates } from './civilSource';
import { excludeSealed, sealedIds, type SealedIds } from './civilHoldoutHelpers';
import type { Candidate } from './sample';
import type { HarvestItem } from './seal';

const GOLDEN = path.join(__dirname, '../datasets/golden');

/** Every civil set already sealed — a representative draw must avoid them all. */
const SPENT = [
  'civil-qa/cases.json',
  'civil-qa-holdout/cases.json',
  'civil-pair/cases.json',
  'civil-pair-holdout/cases.json',
];

function spentIds(manifests: readonly string[]): SealedIds {
  const photoIds = new Set<string>();
  const reviewIds = new Set<string>();
  for (const rel of manifests) {
    const m = path.join(GOLDEN, rel);
    if (!fs.existsSync(m)) continue;
    const cases = JSON.parse(fs.readFileSync(m, 'utf8')) as Array<{
      expected: { photoId?: string; reviewId?: string };
    }>;
    const ids = sealedIds(cases);
    for (const p of ids.photoIds) photoIds.add(p);
    for (const r of ids.reviewIds) reviewIds.add(r);
  }
  return { photoIds, reviewIds };
}

export async function civilRepCandidates(): Promise<Array<Candidate & HarvestItem>> {
  return excludeSealed(await civilCandidates(), spentIds(SPENT));
}
