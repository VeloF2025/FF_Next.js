// tests/unit/vlm-bench/civil-fewshot-ab.test.ts
// The few-shot A/B is only valid if both packs score the SAME photos and differ
// ONLY in the few-shot section. These tests pin both halves of that.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { civilRepPack, civilRepFewshotPack } from '../../../scripts/vlm-bench/packs/civilQa';
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
