/**
 * Pure display-helper tests — Rand formatting and date helpers used
 * across the review queue rows and summary tiles.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { formatDate, formatRand, formatRelative } from '../format';

describe('formatRand', () => {
  it('returns em-dash for non-finite input', () => {
    expect(formatRand(Number.NaN)).toBe('—');
    expect(formatRand(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatRand(Number.NEGATIVE_INFINITY)).toBe('—');
  });

  it('renders R prefix and two-decimal output for zero', () => {
    const out = formatRand(0);
    // en-ZA Intl uses ',' as decimal and ' ' as thousand-sep, but we
    // only care about: starts with 'R', contains the value, has two
    // decimal digits.
    expect(out.startsWith('R')).toBe(true);
    expect(out).toMatch(/0[.,]00$/);
  });

  it('formats positive cents with two decimals', () => {
    const big = formatRand(130000);   // R1<sep>300<dec>00
    expect(big.startsWith('R')).toBe(true);
    expect(big).toMatch(/1[\s,]?300[.,]00$/);

    const small = formatRand(25410);   // R254<dec>10
    expect(small.startsWith('R')).toBe(true);
    expect(small).toMatch(/254[.,]10$/);
  });

  it('formats negative cents (refunds) with a minus', () => {
    const out = formatRand(-100);
    expect(out).toContain('-');
  });
});

describe('formatDate', () => {
  it('formats YYYY-MM-DD as "D Mon YYYY"', () => {
    expect(formatDate('2026-04-25')).toBe('25 Apr 2026');
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026');
    expect(formatDate('2026-12-31')).toBe('31 Dec 2026');
  });

  it('returns the raw string when input has fewer than 3 dash-parts', () => {
    expect(formatDate('2026')).toBe('2026');
    expect(formatDate('')).toBe('');
  });

  it('falls back to the raw month token when the index is out of range', () => {
    // formatDate uses months[Number(m) - 1] ?? m. Month 13 → undefined
    // → falls back to the raw "13" token.
    expect(formatDate('2026-13-01')).toBe('1 13 2026');
  });

  it('does not throw on non-numeric input (production never sends this — DB to_char enforces YYYY-MM-DD)', () => {
    // The current implementation produces a degraded string when
    // given non-numeric tokens. We assert "doesn't throw" rather than
    // locking the exact output, so a future hardening pass on
    // formatDate doesn't have to update this test.
    expect(() => formatDate('not-a-date')).not.toThrow();
    expect(typeof formatDate('not-a-date')).toBe('string');
  });
});

describe('formatRelative', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "Ns ago" for under one minute', () => {
    expect(formatRelative('2026-04-25T11:59:30Z')).toMatch(/^\d+s ago$/);
  });

  it('returns "Nm ago" for minutes', () => {
    expect(formatRelative('2026-04-25T11:30:00Z')).toBe('30m ago');
  });

  it('returns "Nh ago" for hours', () => {
    expect(formatRelative('2026-04-25T05:00:00Z')).toBe('7h ago');
  });

  it('returns "Nd ago" for days', () => {
    expect(formatRelative('2026-04-22T12:00:00Z')).toBe('3d ago');
  });

  it('returns "Nmo ago" for months', () => {
    expect(formatRelative('2026-02-25T12:00:00Z')).toBe('2mo ago');
  });

  it('returns "Ny ago" for years', () => {
    expect(formatRelative('2024-04-25T12:00:00Z')).toBe('2y ago');
  });

  it('returns the raw string for unparseable input', () => {
    expect(formatRelative('garbage')).toBe('garbage');
  });
});
