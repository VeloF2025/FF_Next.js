// scripts/vlm-bench/harvest/categorizationRepSource.ts
// Representative draw for activate photo categorization — the population's own
// wrong/right ratio rather than a forced 50/50. See civilRepSource.ts for why
// this pack exists and for the caveat on reading its number.
//
// Categorization cases are keyed by DR number and photo filename, not by the
// photo/review ids the civil packs use, so it needs its own exclusion. Whole
// DRs are excluded rather than individual photos: one DR is one installation,
// photographed by one technician in one visit, so a prompt tuned on one of its
// photos has partly seen the rest.
import * as fs from 'fs';
import * as path from 'path';
import { categorizationCandidates } from './categorizationSource';
import type { Candidate } from './sample';
import type { HarvestItem } from './seal';

const TUNING_MANIFEST = path.join(__dirname, '../datasets/golden/categorization/cases.json');

interface SealedCase {
  expected: { drNumber?: string };
}

/** DR numbers the tuning set already spent. */
export function spentDrNumbers(cases: readonly SealedCase[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const c of cases) if (c.expected.drNumber) out.add(c.expected.drNumber);
  return out;
}

/** Drop every candidate belonging to a DR the tuning set already used. */
export function excludeDrs<T extends Candidate & HarvestItem>(
  candidates: readonly T[],
  spent: ReadonlySet<string>,
): T[] {
  return candidates.filter((c) => {
    const dr = (c.expected as { drNumber?: string }).drNumber;
    return !(dr && spent.has(dr));
  });
}

export async function categorizationRepCandidates(): Promise<Array<Candidate & HarvestItem>> {
  if (!fs.existsSync(TUNING_MANIFEST)) {
    throw new Error(`categorization-rep needs the sealed tuning manifest at ${TUNING_MANIFEST} to exclude it`);
  }
  const tuning = JSON.parse(fs.readFileSync(TUNING_MANIFEST, 'utf8')) as SealedCase[];
  return excludeDrs(await categorizationCandidates(), spentDrNumbers(tuning));
}
