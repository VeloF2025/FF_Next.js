import { describe, expect, it } from 'vitest';
import { normalizeClientUploadId } from '../clientUploadId';

describe('normalizeClientUploadId', () => {
  const valid = '11111111-2222-4333-8444-555555555555';

  it('returns a well-formed UUID unchanged (lowercased)', () => {
    expect(normalizeClientUploadId(valid)).toBe(valid);
    expect(normalizeClientUploadId(valid.toUpperCase())).toBe(valid);
  });

  it('trims surrounding whitespace before validating', () => {
    expect(normalizeClientUploadId(`  ${valid}  `)).toBe(valid);
  });

  it('returns null for absent values (undefined / null / empty)', () => {
    expect(normalizeClientUploadId(undefined)).toBeNull();
    expect(normalizeClientUploadId(null)).toBeNull();
    expect(normalizeClientUploadId('')).toBeNull();
    expect(normalizeClientUploadId('   ')).toBeNull();
  });

  it('returns null for a malformed key so it never reaches the uuid column', () => {
    expect(normalizeClientUploadId('not-a-uuid')).toBeNull();
    expect(normalizeClientUploadId('1234')).toBeNull();
    expect(normalizeClientUploadId('11111111-2222-4333-8444-5555555555')).toBeNull(); // too short
    expect(normalizeClientUploadId("'; DROP TABLE maintenance_attachments;--")).toBeNull();
    expect(normalizeClientUploadId('gggggggg-2222-4333-8444-555555555555')).toBeNull(); // non-hex
  });
});
