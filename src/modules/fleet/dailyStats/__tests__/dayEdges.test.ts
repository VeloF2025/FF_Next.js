/**
 * The SAST day boundary, which is where this fold is most likely to be quietly wrong.
 *
 * node-postgres parses a DATE (OID 1082) into a JS Date at LOCAL midnight, and `toISOString()` on
 * that shifts backwards across the date line in any positive-offset zone -- so the 1st is reported
 * as the last day of the previous month and lands in the wrong row. SAST is UTC+2 with no DST, so
 * 22:00:00Z is already tomorrow in Johannesburg and 21:59:59Z is still today.
 *
 * The last case here is a grep, not a behaviour test, and it is deliberate: the behaviour tests
 * above pass for a fold that happens to be tested only in the middle of the day, while the grep
 * fails the moment the wrong helper appears anywhere in the module.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { foldVehicleDays } from '../dayFold';
import { fix } from './fixtures';

const MODULE_DIR = join(__dirname, '..');

function fixAt(iso: string) {
  return fix(iso, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: true, speedKph: 0 });
}

describe('which SAST day a fix belongs to', () => {
  it('puts 21:59:59Z on that UTC date and 22:00:00Z on the next one', () => {
    const days = foldVehicleDays([
      fixAt('2026-08-01T21:59:59.000Z'),
      fixAt('2026-08-01T22:00:00.000Z'),
    ]);
    expect(days.map((d) => d.workDate)).toEqual(['2026-08-01', '2026-08-02']);
    expect(days.map((d) => d.positionCount)).toEqual([1, 1]);
  });

  it('keeps the first of a month on the first, which is where a UTC format silently loses it', () => {
    const days = foldVehicleDays([fixAt('2026-08-31T22:00:00.000Z')]);
    expect(days[0]!.workDate).toBe('2026-09-01');
  });
});

describe('a trip that straddles SAST midnight', () => {
  /** 23:00 SAST to 01:00 SAST: exactly one hour on each side of the boundary. */
  const trip = {
    ignitionOnAt: '2026-08-10T21:00:00.000Z',
    ignitionOffAt: '2026-08-10T23:00:00.000Z',
  };

  it('splits its seconds across two rows that sum to the trip', () => {
    const days = foldVehicleDays([], [trip]);
    expect(days.map((d) => d.workDate)).toEqual(['2026-08-10', '2026-08-11']);
    expect(days.map((d) => d.ignitionSeconds)).toEqual([3_600, 3_600]);
    const total = days.reduce((n, d) => n + d.ignitionSeconds, 0);
    expect(total).toBe(7_200);
  });

  it('ignores an open trip, which has no bounded ignition period to split', () => {
    const days = foldVehicleDays([], [{ ignitionOnAt: trip.ignitionOnAt, ignitionOffAt: null }]);
    expect(days).toEqual([]);
  });
});

describe('the helper this module is allowed to use', () => {
  it('never derives a work date through toISOString', () => {
    const offences = readdirSync(MODULE_DIR)
      .filter((f) => f.endsWith('.ts'))
      .flatMap((file) => readFileSync(join(MODULE_DIR, file), 'utf8')
        .split('\n')
        .map((text, i) => ({ file, line: i + 1, text }))
        .filter(({ text }) => !/^\s*(\*|\/\/)/.test(text) && /toISOString\s*\(\s*\)\s*\.\s*slice/.test(text)));
    expect(offences).toEqual([]);
  });

  it('is not vacuous — the module does derive work dates', () => {
    const sources = readdirSync(MODULE_DIR)
      .filter((f) => f.endsWith('.ts'))
      .map((file) => readFileSync(join(MODULE_DIR, file), 'utf8'))
      .join('\n');
    expect(sources).toMatch(/sastDateString/);
  });
});
