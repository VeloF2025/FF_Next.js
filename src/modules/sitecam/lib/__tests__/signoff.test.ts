import { describe, it, expect } from 'vitest';
import { canSubmitSignoff, SIGNOFF_CONSENT_TEXT } from '../signoff';

const SIG = 'data:image/png;base64,abc';

describe('canSubmitSignoff', () => {
  it('is true only when name, consent, and signature are all present', () => {
    expect(canSubmitSignoff({ name: 'Jane Doe', consent: true, signatureDataUrl: SIG })).toBe(true);
  });

  it('is false without a signature', () => {
    expect(canSubmitSignoff({ name: 'Jane Doe', consent: true, signatureDataUrl: null })).toBe(false);
  });

  it('is false without consent', () => {
    expect(canSubmitSignoff({ name: 'Jane Doe', consent: false, signatureDataUrl: SIG })).toBe(false);
  });

  it('is false without a name', () => {
    expect(canSubmitSignoff({ name: '', consent: true, signatureDataUrl: SIG })).toBe(false);
  });

  it('treats a whitespace-only name as empty', () => {
    expect(canSubmitSignoff({ name: '   ', consent: true, signatureDataUrl: SIG })).toBe(false);
  });
});

describe('SIGNOFF_CONSENT_TEXT', () => {
  it('is a non-empty statement the customer confirms', () => {
    expect(SIGNOFF_CONSENT_TEXT.length).toBeGreaterThan(0);
    expect(SIGNOFF_CONSENT_TEXT).toMatch(/installation/i);
  });
});
