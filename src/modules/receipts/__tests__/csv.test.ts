/**
 * CSV-export pure helpers — used by /api/staff/receipts-export.
 * Output goes to accounting; tiny mistakes (an unescaped quote in a
 * vendor name, a NaN in a total) misalign the import. These tests
 * lock the corner cases.
 */

import { describe, it, expect } from 'vitest';

import { csvEscape, centsToRand } from '../csv';

describe('csvEscape', () => {
  it('returns empty string for null and undefined', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('passes through plain ascii unchanged', () => {
    expect(csvEscape('hello world')).toBe('hello world');
  });

  it('quotes a value containing a comma', () => {
    expect(csvEscape('Acme, Ltd.')).toBe('"Acme, Ltd."');
  });

  it('quotes a value containing a newline', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  it('quotes a value containing a CR', () => {
    expect(csvEscape('line1\rline2')).toBe('"line1\rline2"');
  });

  it('quotes a value containing a CR-LF pair', () => {
    expect(csvEscape('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('doubles internal quotes and wraps the whole field', () => {
    expect(csvEscape('She said "hi"')).toBe('"She said ""hi"""');
  });

  it('coerces numbers to their string form', () => {
    expect(csvEscape(42)).toBe('42');
    expect(csvEscape(0)).toBe('0');
  });

  it('coerces booleans', () => {
    expect(csvEscape(true)).toBe('true');
    expect(csvEscape(false)).toBe('false');
  });

  it('coerces objects via String() (callers should rarely do this)', () => {
    // Document existing behaviour rather than adding new validation.
    expect(csvEscape({})).toBe('[object Object]');
  });

  it('quotes the stringified output of an array (commas would otherwise break the field)', () => {
    // Array.toString() yields '1,2,3' — that contains a comma, so the
    // quote-guard MUST fire and wrap the whole value. Without this,
    // an accidental array argument would silently corrupt a CSV row.
    expect(csvEscape([1, 2, 3])).toBe('"1,2,3"');
  });

  it('handles a single-element array without injecting a stray comma', () => {
    expect(csvEscape([42])).toBe('42');
  });
});

describe('centsToRand', () => {
  it('returns empty string for null', () => {
    expect(centsToRand(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(centsToRand(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(centsToRand('')).toBe('');
  });

  it('returns empty string for non-numeric input', () => {
    expect(centsToRand('not-a-number')).toBe('');
  });

  it('returns empty string for NaN-producing input', () => {
    expect(centsToRand('NaN')).toBe('');
  });

  it('formats cents as two-decimal Rand', () => {
    expect(centsToRand('100')).toBe('1.00');
    expect(centsToRand('130000')).toBe('1300.00');
    expect(centsToRand('25410')).toBe('254.10');
  });

  it('rounds to exactly two decimals on integer cents', () => {
    expect(centsToRand('1')).toBe('0.01');
    expect(centsToRand('99')).toBe('0.99');
  });

  it('handles zero correctly', () => {
    expect(centsToRand('0')).toBe('0.00');
  });

  it('handles negative cents (refunds / adjustments)', () => {
    expect(centsToRand('-500')).toBe('-5.00');
  });

  it('does NOT include thousand separators (Excel parses raw numbers)', () => {
    expect(centsToRand('1234567')).toBe('12345.67');
    expect(centsToRand('1234567')).not.toContain(',');
  });

  it('does NOT include a currency symbol', () => {
    const out = centsToRand('100000');
    expect(out).not.toContain('R');
    expect(out).not.toContain('$');
  });
});
