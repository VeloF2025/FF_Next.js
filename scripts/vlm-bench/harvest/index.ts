// scripts/vlm-bench/harvest/index.ts
import * as path from 'path';
import { categorizationCandidates } from './categorizationSource';
import { civilCandidates } from './civilSource';
import { civilHoldoutCandidates } from './civilHoldoutSource';
import { civilPairCandidates, civilPairHoldoutCandidates } from './civilPairSource';
import { civilRepCandidates } from './civilRepSource';
import { categorizationRepCandidates } from './categorizationRepSource';
import { serialsCandidates } from './serialsSource';
import { closeHarvestPool } from './db';
import { stratifiedSample, type Candidate } from './sample';
import { seal, type HarvestItem } from './seal';

type Sourced = Candidate & HarvestItem;

const SOURCES: Record<string, { dir: string; idPrefix: string; load: () => Promise<Sourced[]> }> = {
  categorization: { dir: 'categorization', idPrefix: 'cat', load: categorizationCandidates },
  'civil-qa': { dir: 'civil-qa', idPrefix: 'civil', load: civilCandidates },
  'civil-qa-holdout': { dir: 'civil-qa-holdout', idPrefix: 'civilho', load: civilHoldoutCandidates },
  'civil-pair': { dir: 'civil-pair', idPrefix: 'civilpair', load: civilPairCandidates },
  'civil-pair-holdout': { dir: 'civil-pair-holdout', idPrefix: 'civilpairho', load: civilPairHoldoutCandidates },
  'civil-rep': { dir: 'civil-rep', idPrefix: 'civilrep', load: civilRepCandidates },
  'categorization-rep': { dir: 'categorization-rep', idPrefix: 'catrep', load: categorizationRepCandidates },
  serials: { dir: 'serials', idPrefix: 'serial', load: serialsCandidates },
};

export interface HarvestOpts {
  packId: string;
  goldenRoot: string;
  seed: string;
  /** Total cases; split evenly between the vlm_wrong and vlm_right strata. */
  size: number;
  /**
   * 'balanced' (default) forces a 50/50 wrong/right split — a comparison
   * instrument, deliberately harder than production.
   *
   * 'natural' keeps the population's own ratio instead, so the score estimates
   * accuracy on the labelled workload rather than on a hard slice. Use it to
   * decide WHETHER a pack is worth tuning; use 'balanced' to measure a change.
   * The two are not comparable to each other.
   */
  mix?: 'balanced' | 'natural';
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

  const mix = opts.mix ?? 'balanced';
  let wantWrong: number;
  if (mix === 'natural') {
    // Round the population ratio, then clamp so neither stratum is empty —
    // a set with zero wrong cases cannot show an error and a set with zero
    // right cases cannot show a false positive.
    const ratio = candidates.length === 0 ? 0 : wrong / candidates.length;
    wantWrong = Math.min(opts.size - 1, Math.max(1, Math.round(opts.size * ratio)));
  } else {
    wantWrong = Math.floor(opts.size / 2);
  }
  opts.out(`${opts.packId}: mix=${mix} -> ${wantWrong} wrong / ${opts.size - wantWrong} right\n`);
  const picked = stratifiedSample(candidates, `${opts.seed}:${opts.packId}`, {
    vlm_wrong: wantWrong,
    vlm_right: opts.size - wantWrong,
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
