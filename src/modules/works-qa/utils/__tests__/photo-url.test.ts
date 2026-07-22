import { describe, it, expect } from 'vitest';
import { absolutePhotoUrl } from '../photo-url';

const BASE = 'https://app.fibreflow.app';

describe('absolutePhotoUrl', () => {
  it('serves works-qa uploads from /storage/ absolutely', () => {
    expect(absolutePhotoUrl('works-qa/p/pole/civil/x.jpg', BASE)).toBe(`${BASE}/storage/works-qa/p/pole/civil/x.jpg`);
  });
  it('serves qfield photos via the proxy with source=qfield and the passed vlm auth fragment', () => {
    const url = absolutePhotoUrl('projects/abc/files/DCIM/y.jpg', BASE, '&vlm=true&vlmkey=s3cr3t');
    expect(url.startsWith(`${BASE}/api/construction-qa/photo-proxy?`)).toBe(true);
    expect(url).toContain('source=qfield');
    expect(url).toContain('vlm=true');
    expect(url).toContain('vlmkey=s3cr3t');
    expect(url).toContain(`key=${encodeURIComponent('projects/abc/files/DCIM/y.jpg')}`);
  });
  it('omits vlm=true when no auth fragment is passed (proxy then requires a session)', () => {
    const url = absolutePhotoUrl('projects/abc/files/DCIM/y.jpg', BASE);
    expect(url).toContain('source=qfield');
    expect(url).not.toContain('vlm=true');
  });
  it('sharepoint keys map to source=sharepoint', () => {
    expect(absolutePhotoUrl('sharepoint:drive/item', BASE)).toContain('source=sharepoint');
  });
  it('everything else maps to source=local', () => {
    expect(absolutePhotoUrl('lawley/old/z.jpg', BASE)).toContain('source=local');
  });
  it('returns empty string for empty key', () => {
    expect(absolutePhotoUrl('', BASE)).toBe('');
  });
  it('strips a trailing slash from appBase (no double slash)', () => {
    expect(absolutePhotoUrl('works-qa/p/pole/civil/x.jpg', `${BASE}/`)).toBe(`${BASE}/storage/works-qa/p/pole/civil/x.jpg`);
    expect(absolutePhotoUrl('projects/abc/files/y.jpg', `${BASE}/`)).toContain(`${BASE}/api/construction-qa/photo-proxy?`);
  });
});
