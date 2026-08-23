// scripts/vlm-bench/harvest/civilPairSource.ts
// Pair-focused draws for the During(2) vs Compaction(5) confusion.
//
// The general civil-qa set carries ~10 step-2 and ~11 step-5 cases. At that
// size a two-case swing moves f1 by ~0.1, so it cannot tell a real fix to this
// pair from noise. These packs restrict the population to steps 2 and 5 and
// balance them, so the pair is measured with ~4x the support.
//
// A pair pack is NOT a substitute for the general set: it says nothing about
// whether a fix broke steps 0/1/3/4/6/7. Iterate here, then confirm on
// civil-qa-holdout.
import * as fs from 'fs';
import * as path from 'path';
import { civilCandidates } from './civilSource';
import { excludeSealed, sealedIds, type SealedIds } from './civilHoldoutHelpers';
import type { Candidate } from './sample';
import type { HarvestItem } from './seal';

const GOLDEN = path.join(__dirname, '../datasets/golden');
const PAIR_STEPS = new Set([2, 5]);

/** Union the ids spent by every already-sealed manifest we must not reuse. */
function spentIds(manifests: readonly string[]): SealedIds {
  const photoIds = new Set<string>();
  const reviewIds = new Set<string>();
  for (const m of manifests) {
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

/** Keep only steps 2 and 5, and tag the step as the balancing subgroup. */
function pairOnly<T extends Candidate & HarvestItem>(candidates: readonly T[]): T[] {
  const out: T[] = [];
  for (const c of candidates) {
    const step = (c.expected as { step?: number }).step;
    if (step === undefined || !PAIR_STEPS.has(step)) continue;
    out.push({ ...c, subgroup: `step${step}` });
  }
  return out;
}

/**
 * Iteration set for the 2/5 pair. Excludes the general tuning and holdout sets
 * so it never re-scores a photo either of them already spent.
 */
export async function civilPairCandidates(): Promise<Array<Candidate & HarvestItem>> {
  const spent = spentIds([
    path.join(GOLDEN, 'civil-qa/cases.json'),
    path.join(GOLDEN, 'civil-qa-holdout/cases.json'),
  ]);
  return pairOnly(excludeSealed(await civilCandidates(), spent));
}

/**
 * Holdout for the 2/5 pair. Excludes the general sets AND the pair iteration
 * set, so a prompt tuned against civil-pair can still be scored on photos
 * nobody has looked at.
 */
export async function civilPairHoldoutCandidates(): Promise<Array<Candidate & HarvestItem>> {
  const pairManifest = path.join(GOLDEN, 'civil-pair/cases.json');
  if (!fs.existsSync(pairManifest)) {
    throw new Error(`civil-pair-holdout needs the sealed civil-pair manifest at ${pairManifest} to exclude it`);
  }
  const spent = spentIds([
    path.join(GOLDEN, 'civil-qa/cases.json'),
    path.join(GOLDEN, 'civil-qa-holdout/cases.json'),
    pairManifest,
  ]);
  return pairOnly(excludeSealed(await civilCandidates(), spent));
}
