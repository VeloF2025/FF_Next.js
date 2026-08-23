// scripts/vlm-bench/packs/civilQa.ts
// Construction QA — civil (pole planting) photo step classification, steps 0..7.
import * as fs from 'fs';
import * as path from 'path';
import { VLM_QA_MODEL, VLM_MAX_TOKENS_OCR } from '@/lib/vlm';
import { buildPhotoPrompt } from '@/modules/construction-qa/services/constructionQaPrompt';
import type { BenchCase, LoadOpts, ScoreOutcome, VlmRequest, VlmTestPack } from '../types';
import { parseStep, scoreStep, type StepExpectation } from '../scoring/steps';
import { loadGolden } from '../engine/goldenLoader';

/** Provenance kept on every case so a disputed label can be traced back to its row. */
export interface CivilQaExpected extends StepExpectation {
  reviewId: string;
  photoId: string;
  storageKey: string;
}

/**
 * One pack per sealed dataset. The tuning set and the holdout differ only in
 * which directory they read: same population, same labels, same prompt, same
 * scorer — so a score difference between them is a difference in the photos,
 * not in the measurement.
 */
function makeCivilQaPack(id: string, opts: { fewShotFile?: string; goldenDir?: string } = {}): VlmTestPack {
  // Pinned to a file rather than read live: production loads few-shot from
  // vlm_corrections, which changes daily, and an irreproducible prompt makes
  // every before/after number meaningless. Snapshot with snapFewshot.ts.
  const fewShot = opts.fewShotFile
    ? fs.readFileSync(path.join(__dirname, '..', opts.fewShotFile), 'utf8')
    : '';
  const dir = opts.goldenDir ?? id;
  return {
    id,
    goldenDir: dir,

    async loadCases(mode, opts: LoadOpts): Promise<BenchCase[]> {
      if (mode !== 'golden') {
        throw new Error(`${id} live mode is not implemented (Phase 1)`);
      }
      return loadGolden(path.join(opts.goldenRoot, dir));
    },

    buildPrompt(c: BenchCase): VlmRequest {
      // Production's own builder — imported, never forked.
      //
      // step = null puts it in CLASSIFICATION mode, which is the mode the golden
      // labels came from: every human correction in vlm_corrections is a
      // disagreement about WHICH step a photo belongs to, not about whether a
      // known step passed. fewShotSection is pinned to '' because production
      // loads it from a table that changes daily, which would make scores
      // irreproducible; this pack measures the BASE prompt only.
      const prompt = buildPhotoPrompt('civil', null, null, fewShot);
      return {
        model: VLM_QA_MODEL,
        max_tokens: VLM_MAX_TOKENS_OCR,
        temperature: 0.1, // matches callVlm() in vlmConstructionService
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: c.imageRef } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      };
    },

    score(expected: unknown, actual: string): ScoreOutcome {
      const e = expected as CivilQaExpected;
      return scoreStep(e, parseStep(actual, ['classified_step', 'step']));
    },
  };
}

export const civilQaPack = makeCivilQaPack('civil-qa');
/** Disjoint second draw — see harvest/civilHoldoutSource.ts. */
export const civilQaHoldoutPack = makeCivilQaPack('civil-qa-holdout');

/**
 * Pair-focused draws restricted to During(2) and Compaction(5).
 *
 * Same prompt and same scorer as the general packs — only the population
 * differs — so a score gap between these and civil-qa is a property of the
 * photos, not of the measurement. See harvest/civilPairSource.ts for why the
 * general set cannot resolve this pair.
 *
 * These score ONLY the 2/5 pair. A gain here says nothing about steps
 * 0/1/3/4/6/7; confirm any change on civil-qa-holdout before believing it.
 */
export const civilPairPack = makeCivilQaPack('civil-pair');
export const civilPairHoldoutPack = makeCivilQaPack('civil-pair-holdout');

/**
 * Representative draw — the population's natural wrong/right ratio.
 *
 * Scores are NOT comparable to civil-qa or the pair packs: this measures
 * accuracy on the labelled workload, they measure a deliberately hard slice.
 */
export const civilRepPack = makeCivilQaPack('civil-rep');

/**
 * civil-rep, but WITH production's pinned few-shot block.
 *
 * Same photos, same prompt, same scorer as civilRepPack — the only difference
 * is the few-shot section, so the gap between the two runs IS the few-shot
 * layer's contribution. Production sends this section on every civil call;
 * every other pack here measures the base prompt without it.
 */
export const civilRepFewshotPack = makeCivilQaPack('civil-rep-fewshot', {
  fewShotFile: 'datasets/fewshot/civil.txt',
  goldenDir: 'civil-rep',
});
