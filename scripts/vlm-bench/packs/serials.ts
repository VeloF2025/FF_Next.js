// scripts/vlm-bench/packs/serials.ts
import * as path from 'path';
import { VLM_EXTRACTION_MODEL } from '@/lib/vlm';
import { ONT_SERIAL_BACK_PROMPT } from '@/modules/activate/services/vlmPrompts';
import type { BenchCase, LoadOpts, ScoreOutcome, VlmRequest, VlmTestPack } from '../types';
import { normalizeExact, charErrorRate } from '../scoring/text';
import { loadGolden } from '../engine/goldenLoader';

export const serialsPack: VlmTestPack = {
  id: 'serials',

  async loadCases(mode, opts: LoadOpts): Promise<BenchCase[]> {
    if (mode !== 'golden') {
      throw new Error('serials live mode is not implemented (Phase 1)');
    }
    return loadGolden(path.join(opts.goldenRoot, 'serials'));
  },

  buildPrompt(c: BenchCase): VlmRequest {
    return {
      model: VLM_EXTRACTION_MODEL,
      // The production prompt asks for a JSON object with rawText, so the reply
      // is far longer than a bare serial — 40 tokens truncated it mid-object.
      max_tokens: 200,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: c.imageRef } },
            // Imported from production, not copied: a Nokia ONT back carries
            // both S/N and SSID, and a generic "read the serial" prompt picks
            // the wrong field, so a forked prompt would benchmark a different
            // task than the one production runs.
            { type: 'text', text: ONT_SERIAL_BACK_PROMPT },
          ],
        },
      ],
    };
  },

  score(expected: unknown, actual: string): ScoreOutcome {
    const want = normalizeExact((expected as { serial: string }).serial);
    const { serial, found } = parseSerialReply(actual);
    // found:false is production's "I refuse to guess" path. It is a miss, but a
    // safe one, and must not be scored as a wrong-serial hallucination — those
    // have very different downstream cost.
    if (!found || serial === null) {
      return { pass: false, score: 0, detail: { expected: want, got: null, abstained: true } };
    }
    const got = normalizeExact(serial);
    const cer = charErrorRate(want, got);
    return {
      pass: want === got,
      score: Math.max(0, 1 - cer),
      detail: { cer, expected: want, got, abstained: false },
    };
  },
};

/** Parse the {found, serial, rawText, confidence} object the production prompt asks for. */
function parseSerialReply(actual: string): { found: boolean; serial: string | null } {
  const match = actual.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { found?: unknown; serial?: unknown };
      const serial = typeof parsed.serial === 'string' && parsed.serial.trim() ? parsed.serial.trim() : null;
      return { found: parsed.found === true, serial };
    } catch {
      // fall through: a truncated or unfenced reply still often contains the serial
    }
  }
  const bare = actual.match(/ALCLB4[0-9A-F]{6}/i);
  return bare ? { found: true, serial: bare[0] } : { found: false, serial: null };
}
