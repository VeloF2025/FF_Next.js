// tests/unit/vlm-bench/step-packs.test.ts
import { describe, it, expect } from 'vitest';
import { categorizationPack } from '../../../scripts/vlm-bench/packs/categorization';
import { civilQaPack } from '../../../scripts/vlm-bench/packs/civilQa';
import { buildCategorizationPrompt } from '../../../src/modules/activate/services/categorizationPrompt';
import { buildPhotoPrompt } from '../../../src/modules/construction-qa/services/constructionQaPrompt';
import type { BenchCase } from '../../../scripts/vlm-bench/types';

const catCase = (step: number): BenchCase => ({
  id: 'cat-0001',
  imageRef: 'data:image/jpeg;base64,AAA',
  expected: { step, vlmStepAtReview: 1, stratum: 'vlm_wrong', drNumber: 'DR1234567', photoFilename: 'a.jpg' },
});

const civilCase = (step: number): BenchCase => ({
  id: 'civil-0001',
  imageRef: 'data:image/jpeg;base64,AAA',
  expected: { step, vlmStepAtReview: 2, stratum: 'vlm_wrong', reviewId: 'r', photoId: 'p', storageKey: 'k' },
});

const textOf = (c: BenchCase, pack: typeof categorizationPack): string => {
  const content = pack.buildPrompt(c).messages[0]!.content as Array<{ type: string; text?: string }>;
  return content.find((x) => x.type === 'text')!.text!;
};

describe('categorizationPack.buildPrompt', () => {
  it('sends production buildCategorizationPrompt verbatim, not a fork', () => {
    expect(textOf(catCase(6), categorizationPack)).toBe(buildCategorizationPrompt(1, 'DR1234567'));
  });

  it('carries the case DR number into the prompt', () => {
    expect(textOf(catCase(6), categorizationPack)).toContain('DR1234567');
  });

  it('pins the prompt to one photo, since a golden case is one photo', () => {
    const text = textOf(catCase(6), categorizationPack);
    expect(text).toContain('analyze 1 photos');
  });

  it('uses the 13-step taxonomy (0..12), not the 10 review-level booleans', () => {
    const text = textOf(catCase(6), categorizationPack);
    expect(text).toContain('12. Dome Joint Closed');
    expect(text).toContain('11. Dome Joint Open');
    expect(text).toContain('<number 0-12>');
  });

  it('embeds the image ref', () => {
    const content = categorizationPack.buildPrompt(catCase(6)).messages[0]!.content as Array<{ type: string }>;
    expect(content.some((x) => x.type === 'image_url')).toBe(true);
  });
});

describe('categorizationPack.score', () => {
  it('reads predicted_step out of the categorizations wrapper production asks for', () => {
    const reply = JSON.stringify({ categorizations: [{ photo_index: 1, predicted_step: 6, confidence: 0.9 }] });
    expect(categorizationPack.score(catCase(6).expected, reply).pass).toBe(true);
  });

  it('reads a bare predicted_step when the model drops the wrapper', () => {
    expect(categorizationPack.score(catCase(9).expected, '{"predicted_step": 9}').pass).toBe(true);
  });

  it('fails when the model picks a different step', () => {
    const reply = JSON.stringify({ categorizations: [{ photo_index: 1, predicted_step: 8 }] });
    const r = categorizationPack.score(catCase(9).expected, reply);
    expect(r.pass).toBe(false);
    expect(r.detail?.gotStep).toBe(8);
  });

  it('scores step 0 (Discard) as a real label, not as a missing answer', () => {
    const reply = JSON.stringify({ categorizations: [{ photo_index: 1, predicted_step: 0 }] });
    const r = categorizationPack.score(catCase(0).expected, reply);
    expect(r.pass).toBe(true);
    expect(r.detail?.parsed).toBe(true);
  });
});

describe('civilQaPack.buildPrompt', () => {
  it('sends production buildPhotoPrompt verbatim, not a fork', () => {
    expect(textOf(civilCase(4), civilQaPack)).toBe(buildPhotoPrompt('civil', null, null, ''));
  });

  it('uses classification mode, which is the mode the golden labels came from', () => {
    const text = textOf(civilCase(4), civilQaPack);
    expect(text).toContain('You must CLASSIFY which checklist step this photo belongs to');
    expect(text).toContain('"classified_step": <1-7 or 0 if unrelated/optical>');
  });

  it('pins few-shot examples out, so scores do not move with a live table', () => {
    const text = textOf(civilCase(4), civilQaPack);
    expect(text).not.toContain('Correction Examples');
  });
});

describe('civilQaPack.score', () => {
  it('reads classified_step, the key production parses', () => {
    expect(civilQaPack.score(civilCase(4).expected, '{"classified_step": 4, "valid": true}').pass).toBe(true);
  });

  it('fails on the End Plates / Unrelated confusion the prompt calls out', () => {
    const r = civilQaPack.score(civilCase(4).expected, '{"classified_step": 0}');
    expect(r.pass).toBe(false);
    expect(r.detail?.gotStep).toBe(0);
  });

  it('records the stratum so runs can be split by difficulty', () => {
    expect(civilQaPack.score(civilCase(4).expected, '{"classified_step": 4}').detail?.stratum).toBe('vlm_wrong');
  });
});

describe('pack registration', () => {
  it('rejects live mode until Phase 1 implements it, rather than silently scoring nothing', async () => {
    await expect(categorizationPack.loadCases('live', { goldenRoot: '/tmp' })).rejects.toThrow(/not implemented/);
    await expect(civilQaPack.loadCases('live', { goldenRoot: '/tmp' })).rejects.toThrow(/not implemented/);
  });
});
