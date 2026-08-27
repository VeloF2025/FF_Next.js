/**
 * The calendar-day → instant conversion the hold controls depend on.
 *
 * Two properties, and the second one needs an unusual test.
 *
 *   1. `<input type="date">` yields a bare `YYYY-MM-DD`; the server parses
 *      `nextReviewAt` with `parseStrictIsoInstant`, which refuses it. Asserted
 *      here with that same parser, so this file cannot agree with the panel
 *      about a format the server rejects.
 *   2. The day is anchored to SAST, not to the machine. This CANNOT be proved
 *      by calling the function on a South African box: local midnight and SAST
 *      midnight are then the same instant, so an implementation that dropped
 *      the offset entirely would satisfy every value assertion here. Vitest
 *      resolves the zone before a test can change `process.env.TZ`, so there
 *      is no in-process way to run this one under another zone.
 *
 * So the zone anchor is pinned at the SOURCE: the module must interpolate an
 * explicit offset into the string it parses. That holds in every timezone,
 * including the one everybody actually runs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatSastDate, sastDayStartInstant } from '../retentionHoldDates';
import { parseStrictIsoInstant } from '../../../operations/instantValidation';

describe('sastDayStartInstant', () => {
  it('turns a calendar day into an instant the server will accept', () => {
    const instant = sastDayStartInstant('2026-12-01');
    expect(instant).not.toBeNull();
    expect(parseStrictIsoInstant(instant!)).not.toBeNull();
  });

  it('places the day at midnight SAST', () => {
    expect(sastDayStartInstant('2026-12-01')).toBe('2026-11-30T22:00:00.000Z');
    // Africa/Johannesburg has no DST, so mid-winter lands on the same offset.
    expect(sastDayStartInstant('2026-06-15')).toBe('2026-06-14T22:00:00.000Z');
  });

  /**
   * The zone-independent half. A bare `2026-12-01T00:00:00` is parsed as LOCAL
   * time by the language, which is the bug this whole module exists to avoid —
   * and it is invisible to any value assertion run in SAST.
   */
  it('parses with an explicit +02:00 offset rather than the machine zone', () => {
    const source = readFileSync(join(__dirname, '..', 'retentionHoldDates.ts'), 'utf8');
    const parsed = /Date\.parse\(([^)]*)\)/.exec(source);
    expect(parsed).not.toBeNull();
    expect(parsed![1]).toMatch(/SAST_OFFSET|\+02:00/);
    expect(source).toMatch(/SAST_OFFSET\s*=\s*'\+02:00'/);
  });

  it.each(['2026-12-1', '01/12/2026', '', 'tomorrow', '2026-12-01T00:00:00Z'])(
    'refuses %s rather than sending something the server will reject', (value) => {
      expect(sastDayStartInstant(value)).toBeNull();
    },
  );
});

describe('formatSastDate', () => {
  it('names an instant by the SAST day it falls on', () => {
    // 00:30 SAST on 1 December, which is still 30 November in UTC.
    expect(formatSastDate('2026-11-30T22:30:00.000Z')).toContain('2026');
    expect(formatSastDate('2026-11-30T22:30:00.000Z')).toMatch(/12\/01|01\/12|2026\/12\/01/);
  });
});
