import { describe, it, expect } from 'vitest';
import { validateDeclaration, MAX_CAPTURE_ACCURACY_M } from '../declarationRules';

const GOOD = { lat: -26.2041, lon: 28.0473, accuracyM: 12 };

describe('validateDeclaration', () => {
  it('accepts a well-formed capture', () => {
    const r = validateDeclaration(GOOD);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      lat: -26.2041,
      lon: 28.0473,
      accuracyM: 12,
      label: null,
      requestNote: null,
    });
  });

  it('trims a label and a note, and nulls them when blank', () => {
    const r = validateDeclaration({ ...GOOD, label: '  My yard  ', requestNote: '   ' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.label).toBe('My yard');
    expect(r.value.requestNote).toBeNull();
  });

  // The gate exists because a 500m-error fix guarantees false violations
  // for the life of the address. Boundary is inclusive: exactly 100m passes.
  it(`accepts accuracy of exactly ${MAX_CAPTURE_ACCURACY_M}m`, () => {
    expect(validateDeclaration({ ...GOOD, accuracyM: MAX_CAPTURE_ACCURACY_M }).ok).toBe(true);
  });

  it('rejects accuracy one metre beyond the gate', () => {
    const r = validateDeclaration({ ...GOOD, accuracyM: MAX_CAPTURE_ACCURACY_M + 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/accurate/i);
  });

  it.each([
    ['a missing lat', { ...GOOD, lat: undefined }],
    ['a null lat', { ...GOOD, lat: null }],
    ['a non-numeric lat', { ...GOOD, lat: 'here' }],
    ['NaN', { ...GOOD, lat: NaN }],
    ['an out-of-range lat', { ...GOOD, lat: 91 }],
    ['an out-of-range lon', { ...GOOD, lon: 181 }],
  ])('rejects %s', (_label, input) => {
    expect(validateDeclaration(input).ok).toBe(false);
  });

  // A missing accuracy is not the same as a good one: the browser always
  // supplies it, so absence means something is wrong with the capture.
  it('rejects a missing accuracy', () => {
    expect(validateDeclaration({ ...GOOD, accuracyM: undefined }).ok).toBe(false);
  });

  it('rejects a negative accuracy', () => {
    expect(validateDeclaration({ ...GOOD, accuracyM: -1 }).ok).toBe(false);
  });

  // label is VARCHAR(120): a longer value is a 22001 from Postgres, which
  // would surface as a 500. Reject it here as a 400 instead.
  it('rejects a label longer than 120 characters', () => {
    expect(validateDeclaration({ ...GOOD, label: 'x'.repeat(121) }).ok).toBe(false);
  });

  it('accepts a label of exactly 120 characters', () => {
    expect(validateDeclaration({ ...GOOD, label: 'x'.repeat(120) }).ok).toBe(true);
  });

  it('rejects a note longer than 1000 characters', () => {
    expect(validateDeclaration({ ...GOOD, requestNote: 'x'.repeat(1001) }).ok).toBe(false);
  });

  // A non-string label is a malformed client, not a label to coerce.
  it('rejects a non-string label', () => {
    expect(validateDeclaration({ ...GOOD, label: { toString: () => 'yard' } }).ok).toBe(false);
  });
});
