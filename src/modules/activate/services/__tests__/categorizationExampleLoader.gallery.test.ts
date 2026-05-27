/**
 * Tests for loadGalleryExamples — the gallery-curated few-shot DB path injected
 * into the photo categorization prompt.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db', () => ({
  default: { query: mocks.query },
  pool: { query: mocks.query },
  db: { query: mocks.query },
}));
// loadFewShot/loadPositive pull qa-learning at module load; stub it so importing
// the loader doesn't drag in the whole module.
vi.mock('@/modules/qa-learning', () => ({
  getRelevantExamples: vi.fn(),
  hasCorrections: vi.fn(),
  getPositiveExamples: vi.fn(),
  hasConfirmedCorrect: vi.fn(),
}));

import { loadGalleryExamples } from '../categorizationExampleLoader';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadGalleryExamples', () => {
  it('returns empty string when there are no gallery rows', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    expect(await loadGalleryExamples()).toBe('');
  });

  it('fails open (returns "") when the query throws', async () => {
    mocks.query.mockRejectedValueOnce(new Error('db down'));
    expect(await loadGalleryExamples()).toBe('');
  });

  it('renders good and bad examples under the gallery header', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        { vlm_extracted_value: 'step_6', corrected_value: 'step_6', correction_notes: 'green cable in port', is_canonical: true },
        { vlm_extracted_value: 'step_6', corrected_value: 'reject', correction_notes: 'empty port', is_canonical: false },
      ],
    });

    const out = await loadGalleryExamples();

    expect(out).toContain('### GALLERY-CURATED EXAMPLES:');
    expect(out).toContain('✅ ACCEPT photos for step_6');
    expect(out).toContain('green cable in port');
    expect(out).toContain('❌ REJECT photos for step_6');
    expect(out).toContain('empty port');
  });

  it('caps each side at 4 examples', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      vlm_extracted_value: `step_${i}`,
      corrected_value: 'step_x', // all "good"
      correction_notes: null,
      is_canonical: true,
    }));
    mocks.query.mockResolvedValueOnce({ rows });

    const out = await loadGalleryExamples();
    const acceptLines = out.split('\n').filter((l) => l.startsWith('✅ ACCEPT'));
    expect(acceptLines).toHaveLength(4);
  });
});
