// scripts/vlm-bench/harvest/civilHoldoutSource.ts
// Holdout draw for civil-qa: the same population and the same labelling rules
// as civilSource, minus everything the tuning set already used.
//
// A prompt is edited by looking at the cases it got wrong, so the set it was
// edited against can no longer measure it. This pack exists so a prompt change
// can be scored on photos nobody looked at.
import * as fs from 'fs';
import * as path from 'path';
import { civilCandidates } from './civilSource';
import { excludeSealed, sealedIds } from './civilHoldoutHelpers';
import type { Candidate } from './sample';
import type { HarvestItem } from './seal';

const TUNING_MANIFEST = path.join(__dirname, '../datasets/golden/civil-qa/cases.json');

export async function civilHoldoutCandidates(): Promise<Array<Candidate & HarvestItem>> {
  if (!fs.existsSync(TUNING_MANIFEST)) {
    throw new Error(`civil-qa holdout needs the sealed tuning manifest at ${TUNING_MANIFEST} to exclude it`);
  }
  const tuning = JSON.parse(fs.readFileSync(TUNING_MANIFEST, 'utf8')) as Array<{
    expected: { photoId?: string; reviewId?: string };
  }>;
  return excludeSealed(await civilCandidates(), sealedIds(tuning));
}
