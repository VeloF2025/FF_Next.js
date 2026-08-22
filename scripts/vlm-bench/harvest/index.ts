// scripts/vlm-bench/harvest/index.ts
import * as path from 'path';
import { categorizationCandidates } from './categorizationSource';
import { civilCandidates } from './civilSource';
import { closeHarvestPool } from './db';
import { stratifiedSample, type Candidate } from './sample';
import { seal, type HarvestItem } from './seal';

type Sourced = Candidate & HarvestItem;

const SOURCES: Record<string, { dir: string; idPrefix: string; load: () => Promise<Sourced[]> }> = {
  categorization: { dir: 'categorization', idPrefix: 'cat', load: categorizationCandidates },
  'civil-qa': { dir: 'civil-qa', idPrefix: 'civil', load: civilCandidates },
};

export interface HarvestOpts {
  packId: string;
  goldenRoot: string;
  seed: string;
  /** Total cases; split evenly between the vlm_wrong and vlm_right strata. */
  size: number;
  out: (line: string) => void;
}

/**
 * Sample, download, and seal a golden set for one pack.
 *
 * The split is deliberately even rather than proportional to the population:
 * corrections are ~10% of reviewed photos, so a proportional sample would be
 * almost all easy confirmations and a model that never changed its mind would
 * still score ~90%. Half the set is cases a human already judged WRONG.
 */
export async function harvest(opts: HarvestOpts): Promise<void> {
  const source = SOURCES[opts.packId];
  if (!source) throw new Error(`no harvest source for pack: ${opts.packId} (have: ${Object.keys(SOURCES).join(', ')})`);

  const candidates = await source.load();
  const wrong = candidates.filter((c) => c.stratum === 'vlm_wrong').length;
  opts.out(`${opts.packId}: ${candidates.length} candidates (${wrong} vlm_wrong / ${candidates.length - wrong} vlm_right)\n`);

  const half = Math.floor(opts.size / 2);
  const picked = stratifiedSample(candidates, `${opts.seed}:${opts.packId}`, {
    vlm_wrong: half,
    vlm_right: opts.size - half,
  });

  const dir = path.join(opts.goldenRoot, source.dir);
  const report = await seal(dir, source.idPrefix, picked);
  // Report the strata ACTUALLY sealed, not the ones requested — a failed
  // download silently skews the split, and an unbalanced set read as balanced
  // is exactly the "all passes prove nothing" failure this sample guards against.
  const sealedWrong = report.cases.filter(
    (c) => (c.expected as { stratum?: string }).stratum === 'vlm_wrong',
  ).length;
  opts.out(
    `${opts.packId}: sealed ${report.cases.length}/${picked.length} into ${dir} ` +
      `(${sealedWrong} vlm_wrong / ${report.cases.length - sealedWrong} vlm_right)\n`,
  );
  for (const f of report.failed) opts.out(`  dropped ${f.id}: ${f.reason}\n`);
}

export { closeHarvestPool };
