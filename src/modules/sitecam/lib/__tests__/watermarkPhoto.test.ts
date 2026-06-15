import { describe, it, expect } from 'vitest';
import { formatWatermarkLabel } from '../watermarkPhoto';
import { stepPhotoFilename } from '../savePhotoToDevice';

describe('formatWatermarkLabel', () => {
  it('renders site id with a zero-padded local timestamp', () => {
    const when = new Date(2026, 5, 12, 9, 5); // 12 Jun 2026 09:05 local
    expect(formatWatermarkLabel('DR1866766', when)).toBe('DR1866766 • 2026-06-12 09:05');
  });
});

describe('stepPhotoFilename', () => {
  it('builds a safe filename with site, step and date', () => {
    const when = new Date(2026, 5, 12);
    expect(stepPhotoFilename('DR1866766', 4, when)).toBe('DR1866766_step4_20260612.jpg');
  });

  it('sanitises unsafe characters in the site id', () => {
    const when = new Date(2026, 5, 12);
    expect(stepPhotoFilename('TEST/CIVIL 001', 2, when)).toBe('TEST_CIVIL_001_step2_20260612.jpg');
  });
});
