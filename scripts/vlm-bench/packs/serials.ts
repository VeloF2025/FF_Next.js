// scripts/vlm-bench/packs/serials.ts
// ONT serial OCR. Two variants, because production runs two different prompts:
//   back  — Step 6, the factory S/N on the white label (ONT_SERIAL_BACK_PROMPT)
//   front — Step 9, the hand-applied sticker on the front panel (STEP9_FRONT_PROMPT)
import * as path from 'path';
import { VLM_EXTRACTION_MODEL } from '@/lib/vlm';
import { ONT_SERIAL_BACK_PROMPT, STEP9_FRONT_PROMPT } from '@/modules/activate/services/vlmPrompts';
import type { BenchCase, LoadOpts, ScoreOutcome, VlmRequest, VlmTestPack } from '../types';
import { normalizeExact, charErrorRate } from '../scoring/text';
import { loadGolden } from '../engine/goldenLoader';

export type SerialVariant = 'back' | 'front';

export interface SerialsExpected {
  serial: string;
  /** Defaults to 'back' so the original hand-labelled cases keep working. */
  variant?: SerialVariant;
  stratum?: 'vlm_wrong' | 'vlm_right';
}

/** The front prompt also asks for green lights and a DR number, so it needs more room. */
const MAX_TOKENS: Record<SerialVariant, number> = { back: 200, front: 400 };

const PROMPTS: Record<SerialVariant, string> = {
  back: ONT_SERIAL_BACK_PROMPT,
  front: STEP9_FRONT_PROMPT,
};

const variantOf = (e: unknown): SerialVariant =>
  (e as SerialsExpected)?.variant === 'front' ? 'front' : 'back';

export const serialsPack: VlmTestPack = {
  id: 'serials',

  async loadCases(mode, opts: LoadOpts): Promise<BenchCase[]> {
    if (mode !== 'golden') {
      throw new Error('serials live mode is not implemented (Phase 1)');
    }
    return loadGolden(path.join(opts.goldenRoot, 'serials'));
  },

  buildPrompt(c: BenchCase): VlmRequest {
    const variant = variantOf(c.expected);
    return {
      model: VLM_EXTRACTION_MODEL,
      max_tokens: MAX_TOKENS[variant],
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: c.imageRef } },
            // Imported from production, not copied. A Nokia ONT back carries the
            // S/N alongside the SSID and part number, and the front may show the
            // box's serial behind the device — a generic "read the serial" prompt
            // picks the wrong one, so a forked prompt benchmarks a different task.
            { type: 'text', text: PROMPTS[variant] },
          ],
        },
      ],
    };
  },

  score(expected: unknown, actual: string): ScoreOutcome {
    const e = expected as SerialsExpected;
    const variant = variantOf(e);
    const want = normalizeExact(e.serial);
    const { serial, found } = parseSerialReply(actual, variant);
    // found:false is production's "I refuse to guess" path. It is a miss, but a
    // safe one, and must not be scored as a wrong-serial hallucination — those
    // have very different downstream cost.
    if (!found || serial === null) {
      return { pass: false, score: 0, detail: { expected: want, got: null, abstained: true, variant, stratum: e.stratum } };
    }
    const got = normalizeExact(serial);
    const cer = charErrorRate(want, got);
    return {
      pass: want === got,
      score: Math.max(0, 1 - cer),
      detail: { cer, expected: want, got, abstained: false, variant, stratum: e.stratum },
    };
  },
};

/**
 * Parse the object each production prompt asks for.
 *   back  → { found, serial, rawText, confidence }
 *   front → { greenLightsVisible, ontSerial: { found, serial, ... }, drNumber: {...} }
 */
function parseSerialReply(actual: string, variant: SerialVariant): { found: boolean; serial: string | null } {
  const match = actual.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as Record<string, unknown>;
      const node = (variant === 'front' ? parsed.ontSerial : parsed) as
        | { found?: unknown; serial?: unknown }
        | undefined;
      if (node && typeof node === 'object') {
        const serial = typeof node.serial === 'string' && node.serial.trim() ? node.serial.trim() : null;
        return { found: node.found === true, serial };
      }
    } catch {
      // fall through: a truncated reply still often contains the serial
    }
  }
  const bare = actual.match(/ALCLB4[0-9A-F]{6}/i);
  return bare ? { found: true, serial: bare[0] } : { found: false, serial: null };
}
