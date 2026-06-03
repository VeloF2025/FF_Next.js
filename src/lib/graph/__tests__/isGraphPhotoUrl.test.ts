import { describe, it, expect } from 'vitest';
import { isGraphPhotoUrl } from '../isGraphPhotoUrl';

describe('isGraphPhotoUrl', () => {
  it('accepts canonical Graph drive URLs over HTTPS', () => {
    expect(isGraphPhotoUrl('https://graph.microsoft.com/v1.0/drives/abc/items/xyz/content')).toBe(true);
  });

  it('rejects other hosts (SSRF / token-leak guard)', () => {
    expect(isGraphPhotoUrl('https://evil.example.com/steal')).toBe(false);
    expect(isGraphPhotoUrl('https://graph.microsoft.com.evil.com/x')).toBe(false);
    expect(isGraphPhotoUrl('https://attacker.sharepoint.com/x')).toBe(false);
  });

  it('rejects non-HTTPS schemes', () => {
    expect(isGraphPhotoUrl('http://graph.microsoft.com/v1.0/drives/x')).toBe(false);
    expect(isGraphPhotoUrl('javascript:alert(1)')).toBe(false);
    expect(isGraphPhotoUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects non-string and malformed input', () => {
    expect(isGraphPhotoUrl(undefined)).toBe(false);
    expect(isGraphPhotoUrl(null)).toBe(false);
    expect(isGraphPhotoUrl(123)).toBe(false);
    expect(isGraphPhotoUrl('not a url')).toBe(false);
    expect(isGraphPhotoUrl('')).toBe(false);
  });
});
