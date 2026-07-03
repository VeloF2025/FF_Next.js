import { describe, it, expect, vi } from 'vitest';

// Stub the two heavy criteria builders so we test the APPEAL wrapper in isolation:
// the wrapper must reuse their output verbatim and then add its own section.
vi.mock('@/modules/activate/services/stepQualityCriteria', () => ({
  buildMessageContent: vi.fn(() => ({
    content: [{ type: 'text', text: 'ACTIVATIONS-BASE' }],
    usedFewShot: false,
  })),
}));
vi.mock('@/modules/sitecam/lib/civilStepCriteria', () => ({
  buildCivilMessageContent: vi.fn(() => ({
    content: [{ type: 'text', text: 'CIVILS-BASE' }],
  })),
}));

import { buildAppealPhotoContent, APPEAL_PHOTO_JSON_SHAPE } from '../appealStepCriteria';

function joinText(parts: Array<{ type: string; text?: string }>): string {
  return parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
}

describe('buildAppealPhotoContent', () => {
  it('reuses the activations base prompt and appends the appeal section', () => {
    const parts = buildAppealPhotoContent('activations', 4, 'PHOTO', 'the glare hides it but the ONT is there');
    const text = joinText(parts);
    expect(text).toContain('ACTIVATIONS-BASE');           // base criteria reused
    expect(text).toContain('the glare hides it');          // technician reason injected
    expect(text).toContain('reason_photo_consistency');    // the three appeal checks
    expect(text).toContain('context_aware_rejudge');
    expect(text).toContain('overturn_justification');
    expect(text).toContain('IGNORE');                      // overrides the base JSON shape
  });

  it('uses the civils base prompt for civils job type', () => {
    const parts = buildAppealPhotoContent('civils', 3, 'PHOTO', 'depth is visible on the tape');
    expect(joinText(parts)).toContain('CIVILS-BASE');
  });

  it('truncates an over-long appeal reason to keep the prompt bounded', () => {
    const long = 'x'.repeat(5000);
    const parts = buildAppealPhotoContent('activations', 4, 'PHOTO', long);
    const injected = joinText(parts);
    // 1000-char cap from the builder — the full 5000 must not appear.
    expect(injected).not.toContain('x'.repeat(1001));
  });

  it('exports a JSON shape describing the three checks', () => {
    expect(APPEAL_PHOTO_JSON_SHAPE).toContain('recommendation');
    expect(APPEAL_PHOTO_JSON_SHAPE).toContain('checks');
  });
});
