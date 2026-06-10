/**
 * Tests for the gallery visual few-shot branches of buildMessageContent.
 *
 * loadStepReferences (filesystem refs) is mocked to null so the assertions
 * isolate the gallery-curated example injection.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../qaReferencePhotos', () => ({
  loadStepReferences: () => null,
}));

import { buildMessageContent, QUALITY_CHECK_STEPS, type GalleryExamples } from '../stepQualityCriteria';

const STEP = QUALITY_CHECK_STEPS[0];
const NEW_PHOTO = 'NEWPHOTOBASE64';

function texts(content: { type: string; text?: string }[]): string {
  return content.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('\n');
}

describe('buildMessageContent gallery branches', () => {
  it('text-only path (no refs, no gallery): usedFewShot false, no gallery text', () => {
    const { content, usedFewShot } = buildMessageContent(STEP, NEW_PHOTO);
    expect(usedFewShot).toBe(false);
    expect(texts(content)).not.toContain('GALLERY');
  });

  it('positive gallery examples → few-shot with APPROVED section + image', () => {
    const gallery: GalleryExamples = { positiveBase64: ['POS1'], negativeBase64: [] };
    const { content, usedFewShot } = buildMessageContent(STEP, NEW_PHOTO, gallery);

    expect(usedFewShot).toBe(true);
    expect(texts(content)).toContain('APPROVED');
    expect(texts(content)).not.toContain('REJECT');
    expect(content).toContainEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,POS1' } });
  });

  it('negative gallery examples → REJECT section', () => {
    const gallery: GalleryExamples = { positiveBase64: [], negativeBase64: ['NEG1', 'NEG2'] };
    const { content, usedFewShot } = buildMessageContent(STEP, NEW_PHOTO, gallery);

    expect(usedFewShot).toBe(true);
    expect(texts(content)).toContain('REJECT');
    expect(content).toContainEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,NEG1' } });
    expect(content).toContainEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,NEG2' } });
  });

  it('empty gallery arrays are treated as no gallery', () => {
    const gallery: GalleryExamples = { positiveBase64: [], negativeBase64: [] };
    const { usedFewShot } = buildMessageContent(STEP, NEW_PHOTO, gallery);
    expect(usedFewShot).toBe(false);
  });

  it('gallery prompt instructs VLM that examples are the authoritative standard', () => {
    const gallery: GalleryExamples = { positiveBase64: ['POS1'], negativeBase64: [] };
    const { content } = buildMessageContent(STEP, NEW_PHOTO, gallery);
    const allText = texts(content);
    expect(allText.toUpperCase()).toContain('MUST');
  });
});

describe('QUALITY_CHECK_STEPS coverage', () => {
  it('includes step 3 (Cable Entry Outside)', () => {
    expect(QUALITY_CHECK_STEPS).toContain(3);
  });

  it('includes step 4 (Cable Entry Inside)', () => {
    expect(QUALITY_CHECK_STEPS).toContain(4);
  });

  it('excludes step 6 (handled by ONT cable check)', () => {
    expect(QUALITY_CHECK_STEPS).not.toContain(6);
  });
});

describe('STEP_CRITERIA cross-step guards', () => {
  it('step 1 criteria explicitly rejects utility pole / cable span photos', () => {
    const { content } = buildMessageContent(1, NEW_PHOTO, { positiveBase64: ['POS1'], negativeBase64: [] });
    const allText = texts(content);
    expect(allText.toLowerCase()).toContain('pole');
  });

  it('step 2 criteria explicitly rejects photos with no pole', () => {
    const { content } = buildMessageContent(2, NEW_PHOTO, { positiveBase64: ['POS1'], negativeBase64: [] });
    const allText = texts(content);
    expect(allText.toLowerCase()).toContain('pole');
  });

  it('step 3 criteria exists and mentions cable entry from outside', () => {
    const { content } = buildMessageContent(3, NEW_PHOTO, { positiveBase64: ['POS1'], negativeBase64: [] });
    const allText = texts(content).toLowerCase();
    expect(allText).toContain('outside');
  });

  it('step 4 criteria exists and mentions cable entry from inside', () => {
    const { content } = buildMessageContent(4, NEW_PHOTO, { positiveBase64: ['POS1'], negativeBase64: [] });
    const allText = texts(content).toLowerCase();
    expect(allText).toContain('inside');
  });
});
