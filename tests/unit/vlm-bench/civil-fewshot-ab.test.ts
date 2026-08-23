// tests/unit/vlm-bench/civil-fewshot-ab.test.ts
// The few-shot A/B is only valid if both packs score the SAME photos and differ
// ONLY in the few-shot section. These tests pin both halves of that.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  civilRepPack,
  civilRepFewshotPack,
  civilQaPack,
  civilQaHoldoutPack,
  civilPairPack,
  civilPairHoldoutPack,
} from '../../../scripts/vlm-bench/packs/civilQa';
import { categorizationPack, categorizationRepPack } from '../../../scripts/vlm-bench/packs/categorization';
import { serialsPack } from '../../../scripts/vlm-bench/packs/serials';
import type { BenchCase } from '../../../scripts/vlm-bench/types';

const FEWSHOT = path.join(__dirname, '../../../scripts/vlm-bench/datasets/fewshot/civil.txt');

const caseFor = (imageRef: string): BenchCase =>
  ({ id: 'x', imageRef, expected: { step: 2 } }) as unknown as BenchCase;

const textOf = (pack: typeof civilRepPack): string => {
  const req = pack.buildPrompt(caseFor('data:image/jpeg;base64,AAAA'));
  const parts = req.messages[0]!.content as Array<{ type: string; text?: string }>;
  return parts.find((p) => p.type === 'text')?.text ?? '';
};

describe('civil few-shot A/B', () => {
  it('both packs read the same golden directory', () => {
    // Different ids so runs are distinguishable in vlm_bench_runs, same data.
    expect(civilRepPack.id).not.toBe(civilRepFewshotPack.id);
    expect(civilRepFewshotPack.goldenDir).toBe('civil-rep');
    expect(civilRepPack.goldenDir ?? civilRepPack.id).toBe('civil-rep');
  });

  it('the snapshot file exists and is non-empty', () => {
    expect(fs.readFileSync(FEWSHOT, 'utf8').trim().length).toBeGreaterThan(0);
  });

  it('only the fewshot pack carries the snapshot text', () => {
    const snapshot = fs.readFileSync(FEWSHOT, 'utf8').trim();
    expect(textOf(civilRepFewshotPack)).toContain(snapshot);
    expect(textOf(civilRepPack)).not.toContain(snapshot);
  });

  it('the two prompts differ ONLY by the snapshot', () => {
    // Remove the injected block from the fewshot prompt and the two must match
    // exactly. If anything else diverges, the A/B has a second variable and its
    // measured delta cannot be attributed to few-shot.
    const snapshot = fs.readFileSync(FEWSHOT, 'utf8').trim();
    const stripped = textOf(civilRepFewshotPack).replace(snapshot, '');
    const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
    expect(norm(stripped)).toBe(norm(textOf(civilRepPack)));
  });
});

// A pack's directory is decided in TWO places: `goldenDir ?? id` (used by
// cli.ts to resolve images) and whatever loadCases passes to loadGolden (used
// for the manifest). They agree today only by convention. If they ever
// diverge, a run scores the right labels against the wrong photos and still
// reports a plausible number — silent, and fatal to any A/B.
describe('pack directory invariant', () => {
  const GOLDEN_ROOT = path.join(__dirname, '../../../scripts/vlm-bench/datasets/golden');

  it.each([
    ['serials', serialsPack],
    ['categorization', categorizationPack],
    ['categorization-rep', categorizationRepPack],
    ['civil-qa', civilQaPack],
    ['civil-qa-holdout', civilQaHoldoutPack],
    ['civil-pair', civilPairPack],
    ['civil-pair-holdout', civilPairHoldoutPack],
    ['civil-rep', civilRepPack],
    ['civil-rep-fewshot', civilRepFewshotPack],
  ])('%s loads its manifest from the same dir cli.ts resolves images from', async (_name, pack) => {
    const resolved = pack.goldenDir ?? pack.id;
    const cases = await pack.loadCases('golden', { goldenRoot: GOLDEN_ROOT });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(GOLDEN_ROOT, resolved, 'cases.json'), 'utf8'),
    ) as unknown[];
    // Same count AND same first image ref — a different directory would change both.
    expect(cases).toHaveLength(manifest.length);
    expect(cases[0]?.imageRef).toBe((manifest[0] as { imageRef: string }).imageRef);
  });
});
