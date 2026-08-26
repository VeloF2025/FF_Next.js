/**
 * The detector reads: row mapping, window ordering, and the SQL shape guard.
 *
 * The ordering test is the one that matters. The window is read DESCENDING
 * under a `LIMIT` — so that a backfill dumping a month of history into one tick
 * yields the NEWEST rows rather than the oldest — and reversed in JS. Every
 * detector then assumes ascending order: the theft anchor is "the window's
 * first fix", the stop runs are consecutive, the cadence median is a diff of
 * neighbours. Hand them descending rows and each of those silently means
 * something else while nothing throws.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => db);

import {
  loadDetectorVehicles, loadGapP90Seconds, loadLastPosition, loadPositionWindow,
} from '../detectorQueries';

function row(overrides: Record<string, unknown> = {}) {
  return {
    recorded_at: '2026-08-18T18:00:00.000Z', provider_event_id: 'ct-1', provider: 'cartrack',
    account_ref: 'velocity', ignition: true, lat: '-26.1000000', lon: '28.0500000',
    speed_kph: '60.00', linear_g: '-0.420', lateral_g: '0.000', provider_event_type: 'HARSH_BRAKING',
    ...overrides,
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('loadPositionWindow', () => {
  it('returns the newest-first read ASCENDING, as every detector assumes', async () => {
    db.query.mockResolvedValue([
      row({ recorded_at: '2026-08-18T18:02:00.000Z', provider_event_id: 'c' }),
      row({ recorded_at: '2026-08-18T18:01:00.000Z', provider_event_id: 'b' }),
      row({ recorded_at: '2026-08-18T18:00:00.000Z', provider_event_id: 'a' }),
    ]);

    const positions = await loadPositionWindow('v1', '2026-08-18T06:00:00.000Z', 6_000);

    expect(positions.map((p) => p.providerEventId)).toEqual(['a', 'b', 'c']);
  });

  it('parses NUMERIC strings into numbers and a Date into an ISO instant', async () => {
    db.query.mockResolvedValue([row({ recorded_at: new Date('2026-08-18T18:00:00.000Z') })]);

    const [position] = await loadPositionWindow('v1', '2026-08-18T06:00:00.000Z', 10);

    expect(position).toMatchObject({
      recordedAt: '2026-08-18T18:00:00.000Z', lat: -26.1, lon: 28.05,
      speedKph: 60, linearG: -0.42, lateralG: 0, providerEventType: 'HARSH_BRAKING',
    });
  });

  it('keeps a null g as null — "not reported" is not "reported as zero"', async () => {
    db.query.mockResolvedValue([row({ linear_g: null, lateral_g: null, speed_kph: null })]);

    const [position] = await loadPositionWindow('v1', '2026-08-18T06:00:00.000Z', 10);

    expect(position).toMatchObject({ linearG: null, lateralG: null, speedKph: null });
  });
});

describe('loadLastPosition', () => {
  it('is null for a vehicle that has never reported', async () => {
    db.queryOne.mockResolvedValue(null);

    expect(await loadLastPosition('v1')).toBeNull();
  });
});

describe('loadGapP90Seconds', () => {
  it('parses the percentile, which arrives as a NUMERIC string', async () => {
    db.queryOne.mockResolvedValue({ p90: '30.5' });

    expect(await loadGapP90Seconds('v1', '2026-08-17T19:00:00.000Z')).toBe(30.5);
  });

  it('is null when there were too few fixes to make a gap', async () => {
    db.queryOne.mockResolvedValue({ p90: null });

    expect(await loadGapP90Seconds('v1', '2026-08-17T19:00:00.000Z')).toBeNull();
  });
});

describe('loadDetectorVehicles', () => {
  it('reads after_hours_exempt as a strict boolean, so a null defaults to not-exempt', async () => {
    db.query.mockResolvedValue([
      { id: 'v1', registration: 'ABC', after_hours_exempt: null },
      { id: 'v2', registration: 'DEF', after_hours_exempt: true },
    ]);

    expect(await loadDetectorVehicles()).toEqual([
      { vehicleId: 'v1', registration: 'ABC', afterHoursExempt: false },
      { vehicleId: 'v2', registration: 'DEF', afterHoursExempt: true },
    ]);
  });

  it('only counts a vehicle with an ACTIVE tracker', async () => {
    db.query.mockResolvedValue([]);
    await loadDetectorVehicles();

    const sql = String(db.query.mock.calls[0]?.[0]);
    expect(sql).toContain('fleet_vehicle_trackers');
    expect(sql).toContain('t.is_active');
  });
});

describe('the SQL shape', () => {
  const source = readFileSync(join(__dirname, '..', 'detectorQueries.ts'), 'utf8');

  it('contains no conditional interpolation — those are broken in this repo', () => {
    // `${cond ? sql`AND x` : sql``}` silently produces a malformed query through
    // both the webpack shim and the db-pool tag. Every optional filter must be
    // two whole explicit query branches instead.
    expect(source).not.toMatch(/\$\{[^}]*\?/);
  });

  it('interpolates only the pinned column list, never a value', () => {
    const interpolations = source.match(/\$\{[^}]*\}/g) ?? [];
    expect(new Set(interpolations)).toEqual(new Set(['${POSITION_COLUMNS}']));
  });
});
