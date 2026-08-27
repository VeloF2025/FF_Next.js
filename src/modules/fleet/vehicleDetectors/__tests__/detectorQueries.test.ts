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
  loadDetectorVehicles, loadGapP90Seconds, loadLastPosition, loadPositionWindow, loadVehicleDriverAssignments,
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

describe('loadVehicleDriverAssignments', () => {
  it('reads the DATE columns as YYYY-MM-DD strings, not Dates', async () => {
    // node-postgres parses DATE (OID 1082) into a local Date, which renders a
    // day early once anything serialises it through UTC — and the whole
    // attribution boundary is a date comparison. `to_char` in Postgres is what
    // keeps the value a calendar date all the way through.
    db.query.mockResolvedValue([{
      id: 'assignment-1', staff_id: 'staff-1', staff_name: 'Jane Driver',
      assignment_start: '2026-08-01', assignment_end: null,
    }]);

    const assignments = await loadVehicleDriverAssignments('vehicle-1');

    expect(assignments).toEqual([{
      assignmentId: 'assignment-1', staffId: 'staff-1', staffName: 'Jane Driver',
      assignmentStart: '2026-08-01', assignmentEnd: null,
    }]);
    const [text, params] = db.query.mock.calls[0]!;
    expect(text).toContain("to_char(va.assignment_start, 'YYYY-MM-DD')");
    expect(text).toContain("to_char(va.assignment_end, 'YYYY-MM-DD')");
    expect(params).toEqual(['vehicle-1']);
  });

  it('returns CLOSED rows too — history is the point, and `is_active` is not consulted', async () => {
    // The bug this pins: every close path writes `is_active = false` and the end
    // date in one statement, so an `is_active` predicate makes the date bounds
    // unreachable and drops all 41 closed rows — i.e. every past driver, for
    // every incident older than the current assignment.
    db.query.mockResolvedValue([{
      id: 'assignment-closed', staff_id: 'staff-0', staff_name: 'Past Driver',
      assignment_start: '2026-03-03', assignment_end: '2026-04-30',
    }]);

    const assignments = await loadVehicleDriverAssignments('vehicle-1');

    expect(assignments).toEqual([{
      assignmentId: 'assignment-closed', staffId: 'staff-0', staffName: 'Past Driver',
      assignmentStart: '2026-03-03', assignmentEnd: '2026-04-30',
    }]);
    expect(db.query.mock.calls[0]![0]).not.toContain('is_active');
  });

  it('leaves the covering-instant decision to the resolver — no date predicate in SQL', async () => {
    db.query.mockResolvedValue([]);
    await loadVehicleDriverAssignments('vehicle-1');
    const [text] = db.query.mock.calls[0]!;
    expect(text).toContain('WHERE va.fleet_vehicle_id = $1::uuid');
    expect(text).not.toContain('assignment_start <=');
  });

  it('keeps a missing staff name null rather than an empty string', async () => {
    db.query.mockResolvedValue([{
      id: 'assignment-1', staff_id: 'staff-1', staff_name: null,
      assignment_start: '2026-08-01', assignment_end: '2026-08-20',
    }]);
    const assignments = await loadVehicleDriverAssignments('vehicle-1');
    expect(assignments[0]).toMatchObject({ staffName: null, assignmentEnd: '2026-08-20' });
  });
});
