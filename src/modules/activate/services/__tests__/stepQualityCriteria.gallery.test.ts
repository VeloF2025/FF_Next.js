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

  it('positive gallery examples → few-shot with GALLERY GOOD section + image', () => {
    const gallery: GalleryExamples = { positiveBase64: ['POS1'], negativeBase64: [] };
    const { content, usedFewShot } = buildMessageContent(STEP, NEW_PHOTO, gallery);

    expect(usedFewShot).toBe(true);
    expect(texts(content)).toContain('GALLERY GOOD EXAMPLE');
    expect(texts(content)).not.toContain('GALLERY REJECT');
    expect(content).toContainEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,POS1' } });
  });

  it('negative gallery examples → GALLERY REJECT section', () => {
    const gallery: GalleryExamples = { positiveBase64: [], negativeBase64: ['NEG1', 'NEG2'] };
    const { content, usedFewShot } = buildMessageContent(STEP, NEW_PHOTO, gallery);

    expect(usedFewShot).toBe(true);
    expect(texts(content)).toContain('GALLERY REJECT EXAMPLES'); // plural for 2
    expect(content).toContainEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,NEG1' } });
    expect(content).toContainEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,NEG2' } });
  });

  it('empty gallery arrays are treated as no gallery', () => {
    const gallery: GalleryExamples = { positiveBase64: [], negativeBase64: [] };
    const { usedFewShot } = buildMessageContent(STEP, NEW_PHOTO, gallery);
    expect(usedFewShot).toBe(false);
  });
});
