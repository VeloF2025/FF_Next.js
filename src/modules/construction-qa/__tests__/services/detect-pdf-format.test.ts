import { describe, it, expect } from 'vitest';
import { detectPdfFormat } from '../../services/detect-pdf-format';

const TQR_SAMPLE = `
  Report Document No:  TQR 0012/2026
  Audit Date:          2026-02-03
  1. Finding: Quality X Health    Environment    Traffic    Safety
`;

const FIELD_REPORT_SAMPLE = `
Photo   Location                    Snag
        https://maps.google.com/ Pole Scew
        maps?q=-26.1270374%2C28.473881
26°07'41.2"S 28°28'29.6"E Cable hanging on the ground
`;

const UNKNOWN_SAMPLE = `
  This is a random PDF document
  with no recognisable structure.
`;

describe('detectPdfFormat', () => {
  it('identifies TQR format', () => {
    expect(detectPdfFormat(TQR_SAMPLE)).toBe('tqr');
  });

  it('identifies field report format via Google Maps URL', () => {
    expect(detectPdfFormat(FIELD_REPORT_SAMPLE)).toBe('field_report');
  });

  it('identifies field report format via DMS only', () => {
    const dmsOnly = `26°07'41.2"S 28°28'29.6"E Pole Scew\n- Google Maps`;
    expect(detectPdfFormat(dmsOnly)).toBe('field_report');
  });

  it('returns unknown for unrecognised PDF', () => {
    expect(detectPdfFormat(UNKNOWN_SAMPLE)).toBe('unknown');
  });

  it('prefers TQR when both signatures present', () => {
    const mixed = TQR_SAMPLE + '\nhttps://maps.google.com/ some snag';
    expect(detectPdfFormat(mixed)).toBe('tqr');
  });
});
