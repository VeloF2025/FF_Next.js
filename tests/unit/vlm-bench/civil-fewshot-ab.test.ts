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

// A pack's directory is resolved in two places: `goldenDir ?? id`, which cli.ts
// uses to locate IMAGES, and whatever loadCases passes to loadGolden, which
// supplies the MANIFEST. For packs built by makeCivilQaPack both come from one
// closure variable and cannot diverge; categorization/serials hardcode theirs
// independently and can.
//
// Rather than compare the two derivations (tautological wherever they share a
// variable), this asserts the property that actually matters and can fail for
// every pack: every image the manifest names must EXIST in the directory cli.ts
// will read. A stale manifest, a half-finished harvest, or a genuinely
// mismatched directory all fail here.
describe('pack manifest and images agree', () => {
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
  ])('%s: every case image exists where cli.ts resolves it', async (_name, pack) => {
    const resolved = path.join(GOLDEN_ROOT, pack.goldenDir ?? pack.id);
    const cases = await pack.loadCases('golden', { goldenRoot: GOLDEN_ROOT });
    expect(cases.length).toBeGreaterThan(0);
    const missing = cases
      .map((c) => c.imageRef)
      .filter((ref) => !fs.existsSync(path.join(resolved, ref)));
    expect(missing).toEqual([]);
  });

  it('civil-rep-fewshot scores exactly the civil-rep images', async () => {
    // The A/B is only an A/B if both arms see the same photos.
    const opts = { goldenRoot: GOLDEN_ROOT };
    const base = (await civilRepPack.loadCases('golden', opts)).map((c) => c.imageRef);
    const fs_ = (await civilRepFewshotPack.loadCases('golden', opts)).map((c) => c.imageRef);
    expect(fs_).toEqual(base);
  });
});
