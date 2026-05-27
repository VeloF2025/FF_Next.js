/**
 * Server-side filter parser tests.
 *
 * Locks the contract that BOTH /api/staff/receipts and
 * /api/staff/receipts-export consume — invalid values are silently
 * nulled (never thrown), limit/offset clamp, defaults apply.
 */

import { describe, it, expect } from 'vitest';

import { parseReviewFilters, parseInt32 } from '../reviewFilters';

const VALID_UUID = '11111111-2222-3333-4444-555555555555';

describe('parseReviewFilters — UUID', () => {
  it('accepts a well-formed UUID for staffId', () => {
    expect(parseReviewFilters({ staffId: VALID_UUID }).staffId).toBe(VALID_UUID);
  });

  it('nulls a malformed staffId silently (no throw)', () => {
    expect(parseReviewFilters({ staffId: 'not-a-uuid' }).staffId).toBeNull();
  });

  it('takes the first element when staffId is an array', () => {
    expect(parseReviewFilters({ staffId: [VALID_UUID, 'extra'] }).staffId).toBe(VALID_UUID);
  });

  it('nulls staffId when undefined', () => {
    expect(parseReviewFilters({}).staffId).toBeNull();
  });

  it('handles projectId the same way as staffId', () => {
    expect(parseReviewFilters({ projectId: VALID_UUID }).projectId).toBe(VALID_UUID);
    expect(parseReviewFilters({ projectId: '12345' }).projectId).toBeNull();
  });
});

describe('parseReviewFilters — month', () => {
  it('accepts YYYY-MM', () => {
    expect(parseReviewFilters({ month: '2026-04' }).month).toBe('2026-04');
  });

  it('rejects invalid month numbers', () => {
    expect(parseReviewFilters({ month: '2026-13' }).month).toBeNull();
    expect(parseReviewFilters({ month: '2026-00' }).month).toBeNull();
  });

  it('rejects partial dates and full ISO strings', () => {
    expect(parseReviewFilters({ month: '2026' }).month).toBeNull();
    expect(parseReviewFilters({ month: '2026-04-01' }).month).toBeNull();
    expect(parseReviewFilters({ month: '04-2026' }).month).toBeNull();
  });
});

describe('parseReviewFilters — status', () => {
  it.each(['submitted', 'approved', 'rejected', 'reconciled'])(
    'accepts known status %s',
    (s) => {
      expect(parseReviewFilters({ status: s }).status).toBe(s);
    }
  );

  it('rejects unknown statuses', () => {
    expect(parseReviewFilters({ status: 'pending' }).status).toBeNull();
    expect(parseReviewFilters({ status: 'APPROVED' }).status).toBeNull();
  });

  it('nulls when missing', () => {
    expect(parseReviewFilters({}).status).toBeNull();
  });
});

describe('parseReviewFilters — category', () => {
  it('accepts a known category', () => {
    expect(parseReviewFilters({ category: 'fuel' }).category).toBe('fuel');
  });

  it('rejects an unknown category', () => {
    expect(parseReviewFilters({ category: 'cigarettes' }).category).toBeNull();
  });
});

describe('parseReviewFilters — limit / offset', () => {
  it('defaults limit to defaultLimit and offset to 0', () => {
    const f = parseReviewFilters({}, { defaultLimit: 200, maxLimit: 500 });
    expect(f.limit).toBe(200);
    expect(f.offset).toBe(0);
  });

  it('clamps limit to maxLimit', () => {
    expect(parseReviewFilters({ limit: '99999' }, { defaultLimit: 200, maxLimit: 500 }).limit).toBe(500);
  });

  it('clamps limit to >= 1', () => {
    expect(parseReviewFilters({ limit: '0' }, { defaultLimit: 200, maxLimit: 500 }).limit).toBe(1);
    expect(parseReviewFilters({ limit: '-5' }, { defaultLimit: 200, maxLimit: 500 }).limit).toBe(1);
  });

  it('clamps offset to >= 0', () => {
    expect(parseReviewFilters({ offset: '-100' }).offset).toBe(0);
  });

  it('clamps offset to <= 1_000_000', () => {
    expect(parseReviewFilters({ offset: '999999999' }).offset).toBe(1_000_000);
  });

  it('falls back to default when limit/offset are non-numeric', () => {
    const f = parseReviewFilters({ limit: 'abc', offset: 'xyz' }, { defaultLimit: 50, maxLimit: 100 });
    expect(f.limit).toBe(50);
    expect(f.offset).toBe(0);
  });

  it('honours export-style limits when defaultLimit equals maxLimit', () => {
    // Export route uses defaultLimit:5000, maxLimit:5000 → no client
    // override possible.
    expect(parseReviewFilters({}, { defaultLimit: 5000, maxLimit: 5000 }).limit).toBe(5000);
    expect(parseReviewFilters({ limit: '99999' }, { defaultLimit: 5000, maxLimit: 5000 }).limit).toBe(5000);
  });
});

describe('parseInt32', () => {
  it('returns fallback for null', () => {
    expect(parseInt32(null, { fallback: 7, min: 0, max: 10 })).toBe(7);
  });

  it('truncates floats', () => {
    expect(parseInt32('3.9', { fallback: 0, min: 0, max: 10 })).toBe(3);
  });

  it('clamps below min and above max', () => {
    expect(parseInt32('-5', { fallback: 0, min: 0, max: 10 })).toBe(0);
    expect(parseInt32('20', { fallback: 0, min: 0, max: 10 })).toBe(10);
  });

  it('returns fallback for non-numeric input', () => {
    expect(parseInt32('hello', { fallback: 42, min: 0, max: 100 })).toBe(42);
  });

  it('returns fallback for the string "Infinity"', () => {
    expect(parseInt32('Infinity', { fallback: 1, min: 0, max: 100 })).toBe(1);
  });
});
