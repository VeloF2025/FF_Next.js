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

// optimizeForVlm is a resize step; pass the input through so selection-logic
// tests are not coupled to image-processing internals.
vi.mock('@/modules/activate/services/imagePreprocessService', () => ({
  optimizeForVlm: (b64: string) => Promise.resolve(b64),
}));

// resolveInternalPhotoUrl rewrites proxy paths to backend URLs; pass through
// so tests stay independent of the URL-rewriting implementation.
vi.mock('@/lib/internalPhotoUrl', () => ({
  resolveInternalPhotoUrl: (url: string) => url,
}));

const computeDHash = vi.fn();
const hammingDistance = vi.fn();
vi.mock('@/lib/imageHash', () => ({
  computeDHash: (...a: unknown[]) => computeDHash(...a),
  hammingDistance: (...a: unknown[]) => hammingDistance(...a),
}));

vi.mock('@/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { loadGalleryExamples } from '../vlmGallery';

// Resolve a query result based on the label param ($3).
function mockRowsByLabel(byLabel: Record<string, Array<{ photo_url: string; phash?: string | null }>>) {
  query.mockImplementation((_sql: string, params: unknown[]) => {
    const label = params[2] as string;
    return Promise.resolve({ rows: byLabel[label] ?? [] });
  });
}

beforeEach(() => {
  query.mockReset();
  fetchPhotoAsBase64.mockReset();
  computeDHash.mockReset();
  hammingDistance.mockReset();
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

  it('does not compute a hash when no query photo is given (recency mode)', async () => {
    mockRowsByLabel({ positive: [{ photo_url: 'p1' }], negative: [] });
    fetchPhotoAsBase64.mockImplementation((url: string) => Promise.resolve(`b64-${url}`));
    await loadGalleryExamples(2, 'activation');
    expect(computeDHash).not.toHaveBeenCalled();
  });

  it('ranks examples by visual similarity when a query photo is provided', async () => {
    mockRowsByLabel({
      positive: [
        { photo_url: 'far', phash: 'f' },
        { photo_url: 'near', phash: 'n' },
        { photo_url: 'mid', phash: 'm' },
      ],
      negative: [],
    });
    computeDHash.mockResolvedValue('Q');
    const dist: Record<string, number> = { n: 1, m: 5, f: 20 };
    hammingDistance.mockImplementation((_q: string, p: string) => dist[p] ?? Infinity);
    fetchPhotoAsBase64.mockImplementation((url: string) => Promise.resolve(`b64-${url}`));

    const result = await loadGalleryExamples(4, 'activation', 'QUERYPHOTO');

    expect(computeDHash).toHaveBeenCalledWith('QUERYPHOTO');
    // closest first: near (1) → mid (5) → far (20)
    expect(result?.positiveBase64).toEqual(['b64-near', 'b64-mid', 'b64-far']);
  });

  it('keeps recency order for rows lacking a phash (pre-backfill safe fallback)', async () => {
    mockRowsByLabel({
      positive: [{ photo_url: 'a', phash: null }, { photo_url: 'b', phash: null }],
      negative: [],
    });
    computeDHash.mockResolvedValue('Q');
    hammingDistance.mockReturnValue(Infinity);
    fetchPhotoAsBase64.mockImplementation((url: string) => Promise.resolve(`b64-${url}`));

    const result = await loadGalleryExamples(4, 'activation', 'QUERYPHOTO');
    expect(result?.positiveBase64).toEqual(['b64-a', 'b64-b']);
  });
});
