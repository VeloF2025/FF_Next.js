// scripts/vlm-bench/packs/civilQa.ts
// Construction QA — civil (pole planting) photo step classification, steps 0..7.
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
function makeCivilQaPack(id: string): VlmTestPack {
  return {
    id,

    async loadCases(mode, opts: LoadOpts): Promise<BenchCase[]> {
      if (mode !== 'golden') {
        throw new Error(`${id} live mode is not implemented (Phase 1)`);
      }
      return loadGolden(path.join(opts.goldenRoot, id));
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
      const prompt = buildPhotoPrompt('civil', null, null, '');
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
