/**
 * Unit tests for extractScannedSerial — ISO 15434 / MH10 serial extraction.
 */

import { describe, it, expect } from 'vitest';
import { extractScannedSerial } from '../scannedSerial';

const RS = '\x1e';
const GS = '\x1d';
const EOT = '\x04';

describe('extractScannedSerial', () => {
  it('extracts the S-identified serial from a Nokia GPON DataMatrix (Format 06)', () => {
    // The exact structure read off a Nokia ONT label in the field:
    //   [)>{RS}06{GS}1P3TN01414BA{GS}SALCLB4923FA8{RS}{EOT}
    const payload = `[)>${RS}06${GS}1P3TN01414BA${GS}SALCLB4923FA8${RS}${EOT}`;
    expect(extractScannedSerial(payload)).toBe('ALCLB4923FA8');
  });

  it('handles the envelope when the serial field comes before the part number', () => {
    const payload = `[)>${RS}06${GS}SALCLB48E8235${GS}1P3TN01414BA${RS}${EOT}`;
    expect(extractScannedSerial(payload)).toBe('ALCLB48E8235');
  });

  it('returns a bare 1D / manually-typed serial unchanged', () => {
    expect(extractScannedSerial('ALCLB4922DE2')).toBe('ALCLB4922DE2');
  });

  it('trims surrounding whitespace on a bare serial', () => {
    expect(extractScannedSerial('  ALCLB4922DE2  ')).toBe('ALCLB4922DE2');
  });

  it('does not mangle a bare serial that happens to start with S', () => {
    // No envelope → returned as-is (not treated as an MH10 DI).
    expect(extractScannedSerial('SN12345ABC')).toBe('SN12345ABC');
  });

  it('falls back to the raw text when an envelope has no serial field', () => {
    const payload = `[)>${RS}06${GS}1P3TN01414BA${RS}${EOT}`;
    expect(extractScannedSerial(payload)).toBe(payload.trim());
  });
});
