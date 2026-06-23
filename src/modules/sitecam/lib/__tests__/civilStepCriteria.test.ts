/**
 * Tests for buildCivilMessageContent — the VLM prompt builder for civil steps.
 * Mirrors the activation-path coverage in
 * activate/services/__tests__/stepQualityCriteria.gallery.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  buildCivilMessageContent,
  CIVIL_STEP_CRITERIA,
  CIVIL_QUALITY_STEPS,
  CIVIL_FAIL_REASON_INSTRUCTION,
  type CivilStep,
} from '../civilStepCriteria';
import type { GalleryExamples, VlmContentPart } from '@/modules/activate/services/stepQualityCriteria';

const STEP: CivilStep = 1;
const NEW_PHOTO = 'NEWPHOTOBASE64';

function texts(content: VlmContentPart[]): string {
  return content
    .filter((p): p is Extract<VlmContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

function imageUrls(content: VlmContentPart[]): string[] {
  return content
    .filter((p): p is Extract<VlmContentPart, { type: 'image_url' }> => p.type === 'image_url')
    .map((p) => p.image_url.url);
}

describe('buildCivilMessageContent', () => {
  it('covers all 8 civil steps with criteria', () => {
    for (const step of CIVIL_QUALITY_STEPS) {
      expect(CIVIL_STEP_CRITERIA[step as CivilStep]).toBeDefined();
    }
  });

  it('step 8 is Pole Label (asset capture), not Signature', () => {
    expect(CIVIL_STEP_CRITERIA[8].label).toBe('Pole Label');
    expect(CIVIL_STEP_CRITERIA[8].failReason.toLowerCase()).not.toContain('signature');
  });

  it('no-gallery path: includes criteria text, no GALLERY label, only the new photo', () => {
    const { content } = buildCivilMessageContent(STEP, NEW_PHOTO);
    const t = texts(content);
    expect(t).toContain(CIVIL_STEP_CRITERIA[STEP].requirements);
    expect(t).not.toContain('GALLERY');
    expect(imageUrls(content)).toEqual([`data:image/jpeg;base64,${NEW_PHOTO}`]);
  });

  it('treats empty gallery arrays as no gallery', () => {
    const empty: GalleryExamples = { positiveBase64: [], negativeBase64: [] };
    const { content } = buildCivilMessageContent(STEP, NEW_PHOTO, empty);
    expect(texts(content)).not.toContain('GALLERY');
  });

  it('positive examples → GALLERY GOOD section with the example image before the new photo', () => {
    const gallery: GalleryExamples = { positiveBase64: ['POS1', 'POS2'], negativeBase64: [] };
    const { content } = buildCivilMessageContent(STEP, NEW_PHOTO, gallery);
    expect(texts(content)).toContain('GALLERY GOOD EXAMPLE');
    const urls = imageUrls(content);
    expect(urls).toContain('data:image/jpeg;base64,POS1');
    expect(urls).toContain('data:image/jpeg;base64,POS2');
    // new photo is last
    expect(urls[urls.length - 1]).toBe(`data:image/jpeg;base64,${NEW_PHOTO}`);
  });

  it('negative examples → GALLERY REJECT section', () => {
    const gallery: GalleryExamples = { positiveBase64: [], negativeBase64: ['NEG1'] };
    const { content } = buildCivilMessageContent(STEP, NEW_PHOTO, gallery);
    expect(texts(content)).toContain('GALLERY REJECT EXAMPLE');
    expect(imageUrls(content)).toContain('data:image/jpeg;base64,NEG1');
  });

  it('asks for a free-text fail_reason instead of forcing the canned per-step reason', () => {
    const { content } = buildCivilMessageContent(STEP, NEW_PHOTO);
    const t = texts(content);
    // The technician should get the real reason, not the canned placeholder.
    expect(t).toContain(CIVIL_FAIL_REASON_INSTRUCTION);
    expect(t).not.toContain('the reason must be exactly');
    expect(t).not.toContain(`"fail_reason": "${CIVIL_STEP_CRITERIA[STEP].failReason}"`);
  });

  it('crossStepClassification: prepends the wrong-subject taxonomy of all civil steps', () => {
    const { content } = buildCivilMessageContent(STEP, NEW_PHOTO, undefined, {
      crossStepClassification: true,
    });
    const t = texts(content);
    expect(t).toContain('WRONG-SUBJECT CHECK');
    // Names a sibling step's subject so the model can reclassify a misfiled photo.
    expect(t).toContain(CIVIL_STEP_CRITERIA[7].label); // 'After Photo'
    expect(t).toContain('ONLY DESCRIBE WHAT YOU CAN SEE');
  });

  it('omits the wrong-subject check when crossStepClassification is not set', () => {
    const { content } = buildCivilMessageContent(STEP, NEW_PHOTO);
    expect(texts(content)).not.toContain('WRONG-SUBJECT CHECK');
  });
});
