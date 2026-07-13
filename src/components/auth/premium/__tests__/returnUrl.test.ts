import { describe, it, expect } from 'vitest';
import { safeReturnUrl } from '../safeReturnUrl';

describe('safeReturnUrl', () => {
  it('keeps a normal relative path', () => {
    expect(safeReturnUrl('/procurement/approvals/abc-123')).toBe('/procurement/approvals/abc-123');
  });
  it('rejects absolute http(s) URLs', () => {
    expect(safeReturnUrl('https://evil.com/x')).toBe('/');
  });
  it('rejects protocol-relative URLs', () => {
    expect(safeReturnUrl('//evil.com')).toBe('/');
  });
  it('rejects non-string / array / empty', () => {
    expect(safeReturnUrl(undefined)).toBe('/');
    expect(safeReturnUrl(['/a', '/b'])).toBe('/');
    expect(safeReturnUrl('')).toBe('/');
  });
});
