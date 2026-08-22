// scripts/vlm-bench/packs/categorization.ts
// Activate install-photo step categorization (13-step taxonomy, Step 0..12).
import * as path from 'path';
import { VLM_CATEGORIZATION_MODEL, VLM_MAX_TOKENS_CATEGORIZATION, VLM_TEMPERATURE } from '@/lib/vlm';
import { buildCategorizationPrompt } from '@/modules/activate/services/categorizationPrompt';
import type { BenchCase, LoadOpts, ScoreOutcome, VlmRequest, VlmTestPack } from '../types';
import { parseStep, scoreStep, type StepExpectation } from '../scoring/steps';
import { loadGolden } from '../engine/goldenLoader';

/** Provenance kept on every case so a disputed label can be traced back to its row. */
export interface CategorizationExpected extends StepExpectation {
  drNumber: string;
  photoFilename: string;
}

export const categorizationPack: VlmTestPack = {
  id: 'categorization',

  async loadCases(mode, opts: LoadOpts): Promise<BenchCase[]> {
    if (mode !== 'golden') {
      throw new Error('categorization live mode is not implemented (Phase 1)');
    }
    return loadGolden(path.join(opts.goldenRoot, 'categorization'));
  },

  buildPrompt(c: BenchCase): VlmRequest {
    const e = c.expected as CategorizationExpected;
    // Production's own builder — imported, never forked, so the bench cannot
    // drift from what categorizePhotos() sends.
    //
    // Two pinned deviations from production, both deliberate:
    //  1. photoCount = 1. Production batches VLM_BATCH_SIZE photos per call; a
    //     per-photo golden case cannot reproduce an arbitrary batch. Batch
    //     effects are therefore NOT measured by this pack.
    //  2. No few-shot / positive / gallery sections. Those are loaded from live
    //     tables that change daily, which would make scores irreproducible.
    //     This pack measures the BASE prompt only.
    const prompt = buildCategorizationPrompt(1, e.drNumber);
    return {
      model: VLM_CATEGORIZATION_MODEL,
      max_tokens: VLM_MAX_TOKENS_CATEGORIZATION,
      temperature: VLM_TEMPERATURE,
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
    const e = expected as CategorizationExpected;
    // Production reads categorizations[].predicted_step; accept the bare key too
    // because a single-photo prompt often makes the model drop the wrapper array.
    const step = parseStepFromCategorizations(actual);
    return scoreStep(e, step);
  },
};

function parseStepFromCategorizations(actual: string): number | null {
  const match = actual.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { categorizations?: Array<Record<string, unknown>> };
      const first = parsed.categorizations?.[0];
      if (first) {
        const v = first.predicted_step;
        if (typeof v === 'number') return v;
        if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v.trim());
      }
    } catch {
      // fall through
    }
  }
  return parseStep(actual, ['predicted_step', 'step']);
}
