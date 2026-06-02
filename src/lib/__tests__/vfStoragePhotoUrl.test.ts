import { describe, it, expect } from 'vitest';
import { isAllowedPhotoUrl } from '../vfStoragePhotoUrl';

describe('isAllowedPhotoUrl', () => {
  it('accepts same-origin /storage/ proxy paths', () => {
    expect(isAllowedPhotoUrl('/storage/civils/p1.jpg')).toBe(true);
  });

  it('accepts allow-listed VF Storage hosts', () => {
    expect(isAllowedPhotoUrl('https://app.fibreflow.app/storage/p.jpg')).toBe(true);
    expect(isAllowedPhotoUrl('https://vf.fibreflow.app/p.jpg')).toBe(true);
    expect(isAllowedPhotoUrl('https://dev.fibreflow.app/p.jpg')).toBe(true);
  });

  it('rejects arbitrary external hosts (SSRF/phishing)', () => {
    expect(isAllowedPhotoUrl('https://evil.example.com/p.jpg')).toBe(false);
  });

  it('rejects non-http(s) schemes (javascript:/data: XSS)', () => {
    expect(isAllowedPhotoUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedPhotoUrl('data:image/png;base64,AAAA')).toBe(false);
  });

  it('rejects non-strings and unparsable values', () => {
    expect(isAllowedPhotoUrl(null)).toBe(false);
    expect(isAllowedPhotoUrl(undefined)).toBe(false);
    expect(isAllowedPhotoUrl(42)).toBe(false);
    expect(isAllowedPhotoUrl('not a url')).toBe(false);
  });
});
