// scripts/vlm-bench/packs/serials.ts
import * as fs from 'fs';
import * as path from 'path';
import { VLM_EXTRACTION_MODEL } from '@/lib/vlm';
import type { BenchCase, LoadOpts, ScoreOutcome, VlmRequest, VlmTestPack } from '../types';
import { normalizeExact, charErrorRate } from '../scoring/text';

const PROMPT =
  'Read the equipment serial number from the sticker in this image. ' +
  'Reply with ONLY the serial number, no words, no spaces.';

export const serialsPack: VlmTestPack = {
  id: 'serials',

  async loadCases(mode, opts: LoadOpts): Promise<BenchCase[]> {
    if (mode !== 'golden') {
      throw new Error('serials live mode is implemented in Plan 2');
    }
    const manifest = path.join(opts.goldenRoot, 'serials', 'cases.json');
    return JSON.parse(fs.readFileSync(manifest, 'utf8')) as BenchCase[];
  },

  buildPrompt(c: BenchCase): VlmRequest {
    return {
      model: VLM_EXTRACTION_MODEL,
      max_tokens: 40,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: c.imageRef } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    };
  },

  score(expected: unknown, actual: string): ScoreOutcome {
    const want = normalizeExact((expected as { serial: string }).serial);
    const got = normalizeExact(actual);
    const cer = charErrorRate(want, got);
    return {
      pass: want === got,
      score: Math.max(0, 1 - cer),
      detail: { cer, expected: want, got },
    };
  },
};
