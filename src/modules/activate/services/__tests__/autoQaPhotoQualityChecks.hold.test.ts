/**
 * applyStepQualityCheck must distinguish three outcomes per photo:
 *   - genuine criteria failure  → demote PASS→FAIL
 *   - passes                    → leave as PASS
 *   - check could not complete  → flip `checkIncomplete` so the DR is HELD for
 *                                 human review (never a silent unverified PASS)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../ontBackCableValidator', () => ({ validateOntBackCables: vi.fn() }));
vi.mock('../stepQualityValidationService', () => ({
  QUALITY_CHECK_STEPS: [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12],
  validateStepQuality: vi.fn(),
}));

import { applyStepQualityCheck } from '../autoQaPhotoQualityChecks';
import { validateStepQuality } from '../stepQualityValidationService';
import type { AutoQaPhotoResult } from '../autoQaCommentGenerator';

const mockValidate = vi.mocked(validateStepQuality);

function wallPhoto(): AutoQaPhotoResult {
  return {
    filename: 'wall.jpg',
    step: 5,
    stepLabel: 'Wall for Installation',
    tier: 'review_recommended',
    decision: 'PASS',
    comment: 'Wall for Installation: Accepted after review (90% confidence)',
    confidence: 0.9,
  };
}
const urls = new Map([['wall.jpg', 'http://x/wall.jpg']]);

beforeEach(() => vi.clearAllMocks());

describe('applyStepQualityCheck — hold on incomplete check', () => {
  it('holds (checkIncomplete=true) and keeps the photo unchanged when the check could not complete', async () => {
    mockValidate.mockResolvedValueOnce(
      new Map([['wall.jpg', { filename: 'wall.jpg', step: 5, passes: true, failReason: null, checkFailed: true }]]),
    );
    const photos = [wallPhoto()];

    const summary = await applyStepQualityCheck('DR1', photos, urls);

    expect(summary).toEqual({ demoted: 0, checkIncomplete: true });
    // The photo is NOT falsely failed — it is held for a human instead.
    expect(photos[0].decision).toBe('PASS');
  });

  it('demotes a genuine criteria failure without holding', async () => {
    mockValidate.mockResolvedValueOnce(
      new Map([['wall.jpg', { filename: 'wall.jpg', step: 5, passes: false, failReason: 'No wall mount in view', checkFailed: false }]]),
    );
    const photos = [wallPhoto()];

    const summary = await applyStepQualityCheck('DR1', photos, urls);

    expect(summary).toEqual({ demoted: 1, checkIncomplete: false });
    expect(photos[0].decision).toBe('FAIL');
    expect(photos[0].comment).toBe('No wall mount in view');
  });

  it('leaves a passing photo untouched', async () => {
    mockValidate.mockResolvedValueOnce(
      new Map([['wall.jpg', { filename: 'wall.jpg', step: 5, passes: true, failReason: null, checkFailed: false }]]),
    );
    const photos = [wallPhoto()];

    const summary = await applyStepQualityCheck('DR1', photos, urls);

    expect(summary).toEqual({ demoted: 0, checkIncomplete: false });
    expect(photos[0].decision).toBe('PASS');
  });
});
