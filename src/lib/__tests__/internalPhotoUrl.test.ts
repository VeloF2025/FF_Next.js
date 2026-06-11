/**
 * Tests: resolveInternalPhotoUrl — server-side resolution of the
 * auth-protected /api/activate/photo proxy path to backend source URLs.
 */
import { describe, it, expect } from 'vitest';
import { resolveInternalPhotoUrl } from '../internalPhotoUrl';

describe('resolveInternalPhotoUrl', () => {
  it('routes 1Map photos to the Velocity photo server', () => {
    expect(resolveInternalPhotoUrl('/api/activate/photo/DR1743380/DR1743380_ph_hh2_4865953.jpg')).toBe(
      'http://100.96.203.105:8003/api/photo/DR1743380/DR1743380_ph_hh2_4865953.jpg',
    );
  });

  it('routes WA photos (wa_*) to the VPS photo viewer', () => {
    expect(resolveInternalPhotoUrl('/api/activate/photo/DR1743380/wa_12345.jpg')).toBe(
      'http://72.61.197.178:8866/photos/DR1743380/wa_12345.jpg',
    );
  });

  it('returns absolute URLs unchanged', () => {
    const url = 'https://app.fibreflow.app/storage/sitecam/photo.jpg';
    expect(resolveInternalPhotoUrl(url)).toBe(url);
  });

  it('returns non-matching relative paths unchanged', () => {
    expect(resolveInternalPhotoUrl('/api/other/route')).toBe('/api/other/route');
    expect(resolveInternalPhotoUrl('/api/activate/photo/DR1/extra/depth.jpg')).toBe(
      '/api/activate/photo/DR1/extra/depth.jpg',
    );
  });
});
