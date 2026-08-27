/**
 * Client-side filter helpers — URL-roundtripping and summary coercion
 * for the /staff/receipts review page.
 */

import { describe, it, expect } from 'vitest';

import {
  buildQueryString,
  coerceSummary,
  takeCategory,
  takeMonth,
  takeRawString,
  takeStatus,
  totalMatchingStatus,
} from '../filters';
import { DEFAULT_FILTERS, emptySummary, type Filters, type SummaryShape } from '../types';

describe('takeStatus', () => {
  it('returns null for undefined', () => {
    expect(takeStatus(undefined)).toBeNull();
  });

  it('returns "" for an explicit empty string ("All statuses")', () => {
    expect(takeStatus('')).toBe('');
  });

  it.each(['submitted', 'approved', 'rejected', 'reconciled'])(
    'accepts known status %s',
    (s) => {
      expect(takeStatus(s)).toBe(s);
    }
  );

  it('returns null for unknown values (does NOT silently fall back to default)', () => {
    expect(takeStatus('PENDING')).toBeNull();
    expect(takeStatus('approve')).toBeNull();
  });

  it('takes the first element of an array param', () => {
    expect(takeStatus(['approved', 'rejected'])).toBe('approved');
  });
});

describe('takeCategory', () => {
  it('returns null for undefined', () => {
    expect(takeCategory(undefined)).toBeNull();
  });

  it('returns "" for explicit empty string', () => {
    expect(takeCategory('')).toBe('');
  });

  it('accepts a known category', () => {
    expect(takeCategory('fuel')).toBe('fuel');
  });

  it('rejects an unknown category (returns null, not "other")', () => {
    expect(takeCategory('cigarettes')).toBeNull();
  });
});

describe('takeMonth', () => {
  it('returns null for undefined', () => {
    expect(takeMonth(undefined)).toBeNull();
  });

  it('accepts YYYY-MM', () => {
    expect(takeMonth('2026-04')).toBe('2026-04');
  });

  it('rejects month 00 and 13', () => {
    expect(takeMonth('2026-00')).toBeNull();
    expect(takeMonth('2026-13')).toBeNull();
  });

  it('rejects partial dates', () => {
    expect(takeMonth('2026')).toBeNull();
    expect(takeMonth('2026-04-01')).toBeNull();
  });
});

describe('takeRawString', () => {
  it('returns null for undefined', () => {
    expect(takeRawString(undefined)).toBeNull();
  });

  it('returns the raw string value untouched', () => {
    expect(takeRawString('anything-goes')).toBe('anything-goes');
  });

  it('returns the first array element', () => {
    expect(takeRawString(['a', 'b'])).toBe('a');
  });
});

describe('buildQueryString', () => {
  it('produces only ?status=submitted when called with DEFAULT_FILTERS', () => {
    // DEFAULT_FILTERS.status === 'submitted' (the active backlog
    // default), so the empty-extras call still emits one filter.
    expect(buildQueryString(DEFAULT_FILTERS, {})).toBe('?status=submitted');
  });

  it('returns "" when EVERY field is empty', () => {
    const empty: Filters = {
      status: '',
      staffId: '',
      projectId: '',
      category: '',
      month: '',
    };
    expect(buildQueryString(empty)).toBe('');
  });

  it('serialises set fields and skips empties', () => {
    const f: Filters = {
      status: 'approved',
      staffId: 'staff-uuid',
      projectId: '',
      category: 'fuel',
      month: '',
    };
    const qs = buildQueryString(f);
    expect(qs).toContain('status=approved');
    expect(qs).toContain('staffId=staff-uuid');
    expect(qs).toContain('category=fuel');
    expect(qs).not.toContain('projectId');
    expect(qs).not.toContain('month');
  });

  it('appends extra params (like summary=1)', () => {
    const qs = buildQueryString(DEFAULT_FILTERS, { summary: '1' });
    expect(qs).toContain('summary=1');
  });

  it('appends an offset of "0" — a falsy-looking string, not the same as empty', () => {
    // Regression guard: buildQueryString's extras loop skips falsy VALUES
    // ("" is skipped), but '0' is a non-empty string and must survive —
    // Load More's very first page request depends on offset=0 reaching
    // the API, not being silently dropped like an empty extra would be.
    const qs = buildQueryString(DEFAULT_FILTERS, { offset: '0', limit: '200' });
    expect(qs).toContain('offset=0');
    expect(qs).toContain('limit=200');
  });

  it('skips extra params with an empty value', () => {
    const qs = buildQueryString(DEFAULT_FILTERS, { summary: '' });
    expect(qs).not.toContain('summary=');
  });
});

describe('totalMatchingStatus', () => {
  function summaryWith(counts: Partial<Record<keyof SummaryShape, number>>): SummaryShape {
    const s = emptySummary();
    for (const [k, count] of Object.entries(counts) as [keyof SummaryShape, number][]) {
      s[k] = { count, totalCents: 0 };
    }
    return s;
  }

  it('returns just that bucket when a single status is active', () => {
    // Mirrors the API: with a status filter active, only that bucket is
    // populated (pages/api/staff/receipts.ts scopes the summary query by
    // the same status filter as the list).
    const summary = summaryWith({ submitted: 379 });
    expect(totalMatchingStatus(summary, 'submitted')).toBe(379);
  });

  it('sums every bucket when status is "" (All)', () => {
    const summary = summaryWith({ submitted: 379, approved: 12, rejected: 3, reconciled: 40 });
    expect(totalMatchingStatus(summary, '')).toBe(434);
  });

  it('returns 0 for an empty summary', () => {
    expect(totalMatchingStatus(emptySummary(), 'submitted')).toBe(0);
    expect(totalMatchingStatus(emptySummary(), '')).toBe(0);
  });
});

describe('coerceSummary', () => {
  it('returns the empty summary for null', () => {
    const out = coerceSummary(null);
    expect(out.submitted.count).toBe(0);
    expect(out.submitted.totalCents).toBe(0);
    expect(out.approved.count).toBe(0);
    expect(out.rejected.count).toBe(0);
    expect(out.reconciled.count).toBe(0);
  });

  it('returns the empty summary for non-objects', () => {
    expect(coerceSummary('hello').submitted.count).toBe(0);
    expect(coerceSummary(42).submitted.count).toBe(0);
  });

  it('coerces partial buckets, leaving missing ones at zero', () => {
    const out = coerceSummary({
      approved: { count: 5, totalCents: 12345 },
    });
    expect(out.approved.count).toBe(5);
    expect(out.approved.totalCents).toBe(12345);
    expect(out.submitted.count).toBe(0);
    expect(out.rejected.count).toBe(0);
  });

  it('survives non-numeric values (treats as 0)', () => {
    const out = coerceSummary({ submitted: { count: 'abc', totalCents: null } });
    expect(out.submitted.count).toBe(0);
    expect(out.submitted.totalCents).toBe(0);
  });

  it('ignores extra unknown buckets without throwing', () => {
    const out = coerceSummary({ pending: { count: 99, totalCents: 99 } });
    expect(out).toMatchObject({
      submitted: { count: 0, totalCents: 0 },
    });
  });
});
