/**
 * Tests for loadGalleryExamples — the shared VLM gallery loader.
 * Verifies the per-label fetch (positives never starve negatives), the
 * empty→undefined short-circuit, and non-fatal photo-fetch failures.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/db', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));

const fetchPhotoAsBase64 = vi.fn();
vi.mock('@/modules/activate/services/photoFetchService', () => ({
  fetchPhotoAsBase64: (...a: unknown[]) => fetchPhotoAsBase64(...a),
}));

vi.mock('@/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { loadGalleryExamples } from '../vlmGallery';

// Resolve a query result based on the label param ($3).
function mockRowsByLabel(byLabel: Record<string, Array<{ photo_url: string }>>) {
  query.mockImplementation((_sql: string, params: unknown[]) => {
    const label = params[2] as string;
    return Promise.resolve({ rows: byLabel[label] ?? [] });
  });
}

beforeEach(() => {
  query.mockReset();
  fetchPhotoAsBase64.mockReset();
});

describe('loadGalleryExamples', () => {
  it('returns undefined when there are no positive or negative rows', async () => {
    mockRowsByLabel({ positive: [], negative: [] });
    const result = await loadGalleryExamples(1, 'civils');
    expect(result).toBeUndefined();
    expect(fetchPhotoAsBase64).not.toHaveBeenCalled();
  });

  it('fetches positives and negatives with independent per-label queries', async () => {
    mockRowsByLabel({
      positive: [{ photo_url: 'p1' }, { photo_url: 'p2' }],
      negative: [{ photo_url: 'n1' }],
    });
    fetchPhotoAsBase64.mockImplementation((url: string) => Promise.resolve(`b64-${url}`));

    const result = await loadGalleryExamples(2, 'civils');

    // one query per label
    expect(query).toHaveBeenCalledTimes(2);
    const labelsQueried = query.mock.calls.map((c) => (c[1] as unknown[])[2]);
    expect(labelsQueried).toContain('positive');
    expect(labelsQueried).toContain('negative');

    expect(result?.positiveBase64).toEqual(['b64-p1', 'b64-p2']);
    expect(result?.negativeBase64).toEqual(['b64-n1']);
  });

  it('excludes images whose fetch fails (non-fatal)', async () => {
    mockRowsByLabel({ positive: [{ photo_url: 'ok' }, { photo_url: 'bad' }], negative: [] });
    fetchPhotoAsBase64.mockImplementation((url: string) =>
      url === 'bad' ? Promise.reject(new Error('404')) : Promise.resolve(`b64-${url}`),
    );

    const result = await loadGalleryExamples(3, 'activation');
    expect(result?.positiveBase64).toEqual(['b64-ok']);
  });

  it('returns undefined if the query throws', async () => {
    query.mockRejectedValue(new Error('db down'));
    const result = await loadGalleryExamples(1, 'civils');
    expect(result).toBeUndefined();
  });
});
