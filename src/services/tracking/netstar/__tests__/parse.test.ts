import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseAllActivityCsv } from '../parse';

const fixture = readFileSync(
  join(__dirname, 'fixtures/all-activity-sample.csv'),
  'utf8'
);

import { parseDecimalComma, parseNetstarTs } from '../parse';

describe('parseDecimalComma', () => {
  // Netstar writes numbers with a COMMA decimal separator inside quoted
  // fields. Stripping non-digits turns -26,08975 into -2608975 — a number
  // that still looks like a number and is nowhere on Earth.
  it('reads a comma as the decimal point', () => {
    expect(parseDecimalComma('-26,08975')).toBeCloseTo(-26.08975, 5);
    expect(parseDecimalComma('28,35431')).toBeCloseTo(28.35431, 5);
    expect(parseDecimalComma('0,0')).toBe(0);
  });
  it('still reads plain integers', () => {
    expect(parseDecimalComma('54302')).toBe(54302);
  });
  it('returns null for blank or unparseable input', () => {
    expect(parseDecimalComma('')).toBeNull();
    expect(parseDecimalComma(undefined)).toBeNull();
    expect(parseDecimalComma('  ')).toBeNull();
  });
});

describe('parseNetstarTs', () => {
  // DD/MM/YYYY, no zone marker, meaning SAST (UTC+02:00).
  it('reads DD/MM/YYYY HH:mm:ss as SAST', () => {
    expect(parseNetstarTs('04/08/2026 07:26:38')?.toISOString())
      .toBe('2026-08-04T05:26:38.000Z');
  });
  it('does not read it as MM/DD/YYYY', () => {
    // 13 cannot be a month; if this parses, the day/month order is wrong.
    expect(parseNetstarTs('13/08/2026 07:26:38')?.toISOString())
      .toBe('2026-08-13T05:26:38.000Z');
  });
  it('returns null for junk', () => {
    expect(parseNetstarTs('not a date')).toBeNull();
  });
});

describe('parseAllActivityCsv', () => {
  it('returns one position per data row', () => {
    expect(parseAllActivityCsv(fixture).length).toBe(50);
  });

  it('produces coordinates inside South Africa', () => {
    for (const p of parseAllActivityCsv(fixture)) {
      expect(p.lat).toBeGreaterThan(-35);
      expect(p.lat).toBeLessThan(-22);
      expect(p.lon).toBeGreaterThan(16);
      expect(p.lon).toBeLessThan(33);
    }
  });

  it('parses the first row exactly', () => {
    const p = parseAllActivityCsv(fixture)[0];
    expect(p.lat).toBeCloseTo(-26.08975, 5);
    expect(p.lon).toBeCloseTo(28.35431, 5);
    expect(p.speedKph).toBe(0);
    expect(p.odometerKm).toBe(54302);
    expect(p.roadSpeedKph).toBe(60);
    expect(p.recordedAt.toISOString()).toBe('2026-08-04T05:26:38.000Z');
  });

  it('reports ignition only on transition rows, null otherwise', () => {
    const rows = parseAllActivityCsv(fixture);
    // Row 1 is "Ignition on"; the "Timed Event" rows that follow say nothing
    // about ignition and must not claim to.
    expect(rows[0].ignition).toBe(true);
    expect(rows[1].ignition).toBeNull();
  });

  it('never infers isSpeeding for non-speeding rows', () => {
    for (const p of parseAllActivityCsv(fixture)) {
      expect(p.isSpeeding === true || p.isSpeeding === null).toBe(true);
    }
  });

  it('leaves fields Netstar does not supply as null, never zero', () => {
    const p = parseAllActivityCsv(fixture)[0];
    expect(p.linearG).toBeNull();
    expect(p.lateralG).toBeNull();
    expect(p.bearing).toBeNull();
    expect(p.altitudeM).toBeNull();
    expect(p.providerEventId).toBeNull();
  });

  it('drops rows whose Gps column is false', () => {
    const lines = fixture.split('\r\n');
    const bad = lines[1].replace(',true,', ',false,');
    expect(parseAllActivityCsv(`${lines[0]}\r\n${bad}`)).toEqual([]);
  });

  it('returns an empty array for a header-only export', () => {
    expect(parseAllActivityCsv(fixture.split('\r\n')[0])).toEqual([]);
  });
});
