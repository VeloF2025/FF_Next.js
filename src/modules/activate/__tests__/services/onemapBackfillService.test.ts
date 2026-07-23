vi.mock('@/lib/db', () => ({
  default: { query: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { describe, it, expect, vi } from 'vitest';
import { decidePhotoWrite, extractOntSerial } from '../../services/onemapBackfillService';
import {
  buildAgedOutQuery,
  buildCandidateQuery,
  IN_SCOPE_FROM,
  LOOKBACK_WINDOW,
  RETRY_COOLDOWN,
} from '../../services/onemapBackfillQueries';

describe('decidePhotoWrite', () => {
  it('writes a complete set and clears the mismatch flag', () => {
    const d = decidePhotoWrite(0, 10, 10);
    expect(d.writePhotos).toBe(true);
    expect(d.mismatch).toBe(false);
  });

  it('writes an improved-but-still-short set and keeps the mismatch flag', () => {
    // The 2026-07-23 shape: 5 of 10 stored, re-download got us to 8 of 10.
    const d = decidePhotoWrite(5, 8, 10);
    expect(d.writePhotos).toBe(true);
    expect(d.mismatch).toBe(true);
  });

  it('REFUSES to shrink a stored photo set', () => {
    // Upstream returned fewer than we already hold — cache eviction, an
    // unfinished download, a degraded backend. Must never overwrite.
    const d = decidePhotoWrite(10, 2, 16);
    expect(d.writePhotos).toBe(false);
    expect(d.mismatch).toBe(true);
    expect(d.reason).toMatch(/refusing to shrink/i);
  });

  it('refuses to wipe a stored set when upstream returns zero photos', () => {
    const d = decidePhotoWrite(12, 0, 12);
    expect(d.writePhotos).toBe(false);
  });

  it('allows an equal count through (idempotent re-verify)', () => {
    const d = decidePhotoWrite(9, 9, 9);
    expect(d.writePhotos).toBe(true);
    expect(d.mismatch).toBe(false);
  });

  it('treats a genuinely empty DR as writable when nothing is stored', () => {
    const d = decidePhotoWrite(0, 0, 0);
    expect(d.writePhotos).toBe(true);
    expect(d.mismatch).toBe(false);
  });
});

describe('buildCandidateQuery', () => {
  it('unverified mode selects never-verified rows and cooled-off mismatches', () => {
    const q = buildCandidateQuery('unverified');
    expect(q).toContain('photo_count_verified_at IS NULL');
    expect(q).toContain('photo_count_mismatch = TRUE');
    expect(q).toContain(`INTERVAL '${RETRY_COOLDOWN}'`);
    expect(q).toContain(`INTERVAL '${LOOKBACK_WINDOW}'`);
  });

  it('unverified mode drains oldest-first so a live incident cannot starve the backlog', () => {
    expect(buildCandidateQuery('unverified')).toContain('ORDER BY created_at ASC');
  });

  it('binds the limit rather than interpolating it', () => {
    for (const mode of ['missing_photos', 'missing_serials', 'unverified', 'all_missing']) {
      expect(buildCandidateQuery(mode)).toContain('LIMIT $1');
    }
  });

  it('falls back to all_missing for an unknown mode instead of building empty SQL', () => {
    const q = buildCandidateQuery("'; DROP TABLE dr_photo_unified_reviews; --");
    expect(q).toBe(buildCandidateQuery('all_missing'));
    expect(q).not.toContain('DROP TABLE');
  });

  it('preserves the pre-existing zero-photo modes', () => {
    expect(buildCandidateQuery('missing_photos')).toContain('photo_count = 0');
    expect(buildCandidateQuery('missing_serials')).toContain('ont_serial_scanned IS NULL');
  });
});

describe('buildAgedOutQuery', () => {
  const q = buildAgedOutQuery();

  it('counts rows confirmed short, at any age', () => {
    expect(q).toContain('photo_count_mismatch = TRUE');
  });

  it('ALSO counts in-scope rows the cron never reached before they aged out', () => {
    // The blind spot this closes: photo_count_mismatch defaults to FALSE and is
    // only written for a row that was actually attempted. A row the cron never
    // got to keeps mismatch=FALSE and verified_at=NULL, so counting only
    // mismatch would make it invisible to the selector AND the metric the
    // moment it left the window.
    expect(q).toContain('photo_count_verified_at IS NULL');
    expect(q).toMatch(/photo_count_mismatch = TRUE\s*OR/);
  });

  it('excludes pre-go-live rows, whose null verified_at is an artifact not a backlog', () => {
    expect(q).toContain(`TIMESTAMPTZ '${IN_SCOPE_FROM}'`);
  });

  it('binds the go-live guard to the never-verified arm ONLY', () => {
    // A confirmed shortfall is worth reporting at any vintage, so the cutoff
    // must not gate arm 1. Proven by exclusion, not just by position: nothing
    // before the never-verified arm may mention the cutoff.
    const armStart = q.indexOf('photo_count_verified_at IS NULL');
    expect(armStart).toBeGreaterThan(-1);
    expect(q.slice(0, armStart)).not.toContain(IN_SCOPE_FROM);
    expect(q.slice(armStart)).toContain(`TIMESTAMPTZ '${IN_SCOPE_FROM}'`);
  });

  it('pins the cutoff to SAST midnight — the DB session runs in UTC', () => {
    expect(IN_SCOPE_FROM).toMatch(/\+02:00$/);
    expect(q).toContain('TIMESTAMPTZ');
  });

  it('only looks outside the lookback window — in-window rows are still retryable', () => {
    expect(q).toContain(`created_at <= NOW() - INTERVAL '${LOOKBACK_WINDOW}'`);
  });
});

describe('extractOntSerial', () => {
  it('pulls the serial out of a barcode payload', () => {
    expect(extractOntSerial('(S)ALCLB4942776(23S)XYZ(20S)Q')).toBe('ALCLB4942776');
  });

  it('passes a bare serial through unchanged', () => {
    expect(extractOntSerial('ALCLB4940D5E')).toBe('ALCLB4940D5E');
  });

  it('returns null for empty input', () => {
    expect(extractOntSerial(null)).toBeNull();
    expect(extractOntSerial('')).toBeNull();
  });
});
