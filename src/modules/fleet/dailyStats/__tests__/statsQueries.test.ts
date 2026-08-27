/**
 * The vehicle-day read path.
 *
 * Two classes of defect are pinned here, both of which produce a plausible answer rather than an
 * error:
 *
 *   The WINDOW. SAST is UTC+2, so an instant at 22:30 UTC is already tomorrow in Johannesburg. A
 *   window built from the host's own calendar is a day out whenever the host runs in UTC — which
 *   the CI runner does — and the page then silently omits a day at one end. Every test here runs
 *   with the process in UTC on purpose: computing the window through `toISOString().slice(0, 10)`
 *   or `new Date().getDate()` fails them.
 *
 *   The DATE COLUMN. node-postgres parses DATE (OID 1082) into a JS `Date` at LOCAL midnight;
 *   `toISOString()` on that reports the 1st as the last day of the previous month in any
 *   positive-offset zone. The mapper reads the calendar parts through `toWorkDate` instead.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: mocks.query, queryOne: mocks.queryOne }));

import {
  daysBetweenInclusive,
  loadFirstPositionWorkDate,
  loadFleetDayOverview,
  loadVehicleDayStats,
  loadVehicleIdentity,
  sastToday,
  sastYesterday,
  statsWindow,
} from '../statsQueries';

const VEHICLE = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

/** A row shaped exactly as `fleet_vehicle_daily_stats` hands it back: BIGINT/NUMERIC as strings. */
function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    work_date: new Date(2026, 7, 20),
    ignition_seconds: '3600', moving_seconds: '3000', idle_seconds: '600',
    unattributed_seconds: '0', distance_km: '42.75', max_speed_kph: '118.40',
    speeding_events: '2', speeding_seconds: '540',
    harsh_brake_events: '1', harsh_accel_events: '0', harsh_corner_events: '3',
    first_ignition_at: '2026-08-20T04:10:00.000Z',
    last_ignition_at: '2026-08-20T15:00:00.000Z',
    position_count: '1169', tracker_silence_seconds: '480',
    provider: 'cartrack', account_ref: 'velocity',
    coverage_granularity: 'history',
    coverage_ignition: true, coverage_gforce: false,
    coverage_provider_events: true, coverage_complete: true,
    source_watermark: '2026-08-20T21:59:00.000Z',
    computed_at: '2026-08-21T00:05:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue([]);
  mocks.queryOne.mockResolvedValue(null);
});

describe('the window is a SAST window', () => {
  it('spans 30 inclusive days ending on the given date', () => {
    expect(statsWindow('2026-08-25', 30)).toEqual({
      startWorkDate: '2026-07-27', endWorkDate: '2026-08-25', days: 30,
    });
  });

  it('clamps a request beyond the cap instead of serving it', () => {
    expect(statsWindow('2026-08-25', 500).days).toBe(90);
    expect(statsWindow('2026-08-25', 0).days).toBe(1);
  });

  it('crosses a month boundary without losing a day', () => {
    expect(statsWindow('2026-03-01', 2).startWorkDate).toBe('2026-02-28');
  });

  it('reads 22:30 UTC as the NEXT SAST day', () => {
    // 2026-08-25T22:30:00Z is 2026-08-26 00:30 in Johannesburg. A UTC "today" answers 08-25 and
    // the whole window is a day short.
    expect(sastToday(Date.parse('2026-08-25T22:30:00.000Z'))).toBe('2026-08-26');
    expect(sastYesterday(Date.parse('2026-08-25T22:30:00.000Z'))).toBe('2026-08-25');
  });

  it('counts inclusive days between two SAST dates', () => {
    expect(daysBetweenInclusive('2026-08-01', '2026-08-01')).toBe(1);
    expect(daysBetweenInclusive('2026-07-27', '2026-08-25')).toBe(30);
  });
});

describe('loadVehicleDayStats', () => {
  it('binds the window as SAST calendar dates, not instants', async () => {
    await loadVehicleDayStats(VEHICLE, statsWindow('2026-08-25', 30));
    const [, params] = mocks.query.mock.calls[0]!;
    expect(params).toEqual([VEHICLE, '2026-07-27', '2026-08-25']);
  });

  it('reads the DATE column through its calendar parts, never through UTC', async () => {
    // A JS Date at LOCAL midnight on the 1st: `toISOString().slice(0,10)` reports the previous
    // month's last day in any positive-offset zone, and the row lands on the wrong bar.
    mocks.query.mockResolvedValue([dbRow({ work_date: new Date(2026, 7, 1) })]);
    const rows = await loadVehicleDayStats(VEHICLE, statsWindow('2026-08-25', 30));
    expect(rows[0]!.workDate).toBe('2026-08-01');
  });

  it('returns only the days that exist — it never fills a gap with zeros', async () => {
    mocks.query.mockResolvedValue([
      dbRow({ work_date: new Date(2026, 7, 20) }),
      dbRow({ work_date: new Date(2026, 7, 23) }),
    ]);
    const rows = await loadVehicleDayStats(VEHICLE, statsWindow('2026-08-25', 30));
    expect(rows.map((r) => r.workDate)).toEqual(['2026-08-20', '2026-08-23']);
  });

  it('parses NUMERIC as a decimal and BIGINT as a number', async () => {
    mocks.query.mockResolvedValue([dbRow()]);
    const [row] = await loadVehicleDayStats(VEHICLE, statsWindow('2026-08-25', 30));
    // parseInt here would silently drop 0.75 km off every day.
    expect(row!.distanceKm).toBe(42.75);
    expect(row!.maxSpeedKph).toBe(118.4);
    expect(row!.ignitionSeconds).toBe(3600);
    expect(typeof row!.positionCount).toBe('number');
  });

  it('keeps a null max speed null rather than turning it into 0', async () => {
    mocks.query.mockResolvedValue([dbRow({ max_speed_kph: null })]);
    const [row] = await loadVehicleDayStats(VEHICLE, statsWindow('2026-08-25', 30));
    expect(row!.maxSpeedKph).toBeNull();
  });
});

describe('loadFirstPositionWorkDate', () => {
  it('answers in SAST, so a 22:30 UTC first fix is the next day', async () => {
    mocks.queryOne.mockResolvedValue({ first_at: '2026-08-25T22:30:00.000Z' });
    expect(await loadFirstPositionWorkDate(VEHICLE)).toBe('2026-08-26');
  });

  it('is null for a vehicle that has never reported', async () => {
    mocks.queryOne.mockResolvedValue({ first_at: null });
    expect(await loadFirstPositionWorkDate(VEHICLE)).toBeNull();
  });
});

describe('loadVehicleIdentity', () => {
  it('is null for an unknown vehicle, which is the API 404', async () => {
    mocks.queryOne.mockResolvedValue(null);
    expect(await loadVehicleIdentity(VEHICLE)).toBeNull();
  });

  it('returns the registration when the vehicle exists', async () => {
    mocks.queryOne.mockResolvedValue({
      id: VEHICLE, registration: 'AB12CD GP', make: 'Toyota', model: 'Hilux', status: 'active',
    });
    expect(await loadVehicleIdentity(VEHICLE)).toEqual({
      vehicleId: VEHICLE, registration: 'AB12CD GP', make: 'Toyota', model: 'Hilux', status: 'active',
    });
  });
});

describe('loadFleetDayOverview', () => {
  it('keeps a tracked vehicle with no row for the day, with null stats', async () => {
    mocks.query.mockResolvedValue([
      { id: 'v1', registration: 'AAA', make: null, model: null, status: 'active', has_stats: false,
        ...dbRow({ work_date: null, coverage_granularity: null }) },
      { id: 'v2', registration: 'BBB', make: null, model: null, status: 'active', has_stats: true,
        ...dbRow() },
    ]);
    const rows = await loadFleetDayOverview('2026-08-24');
    // The LEFT JOIN's whole point: the silent vehicle is the interesting line, and it must not be
    // dropped nor arrive carrying the join's null columns as zeros.
    expect(rows[0]!.stats).toBeNull();
    expect(rows[1]!.stats?.distanceKm).toBe(42.75);
  });

  it('binds the day as a DATE parameter', async () => {
    await loadFleetDayOverview('2026-08-24');
    const [, params] = mocks.query.mock.calls[0]!;
    expect(params).toEqual(['2026-08-24']);
  });

  it('joins the stats table on the LEFT — an inner join deletes the silent vehicle', async () => {
    await loadFleetDayOverview('2026-08-24');
    // Pinned as SQL TEXT as well as behaviour. The behaviour test above passes with an inner join
    // too, because a faithful double returns whatever rows it is given: only the query itself
    // decides whether a vehicle with no row for the day is in the result set at all, and a
    // tracker that reported nothing is precisely the line this table exists to show.
    const sql = String(mocks.query.mock.calls[0]?.[0] ?? '');
    expect(sql).toMatch(/LEFT JOIN fleet_vehicle_daily_stats/);
    // And the day predicate belongs to the JOIN, not to WHERE: moving it to WHERE turns the outer
    // join back into an inner one by filtering the null-extended rows out again.
    expect(sql).toMatch(/LEFT JOIN fleet_vehicle_daily_stats s\s+ON s\.vehicle_id = v\.id AND s\.work_date = \$1::date/);
    expect(sql).not.toMatch(/WHERE[\s\S]*s\.work_date/);
  });
});
