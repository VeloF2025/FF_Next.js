import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: { query: vi.fn() } }));
vi.mock('@/lib/db-pool', () => ({ sql: sqlMock }));

import { runCheckinLocations, NEAR_THRESHOLD_M } from '../checkinLocations';
import { MIN_POLES_FOR_AOI, SA_LAT_MIN, SA_LON_MAX } from '../projectAoiSql';
import { REPORT_ROW_CAP, ReportTooLargeError } from '../runner';
import type { ReportInput } from '../types';

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    scopedStaffIds: ['staff-1'],
    hasAnyStaff: true,
    scope: {} as ReportInput['scope'],
    dateFrom: '2026-07-20',
    dateTo: '2026-08-18',
    departments: [],
    siteIds: [],
    staffIdsHint: [],
    ...overrides,
  };
}

const FACT = {
  entry_id: 'entry-1',
  work_date: '2026-08-18',
  time_sast: '07:42',
  event: 'in' as const,
  full_name: 'Alice Worker',
  employee_id: 'EMP-1',
  department: 'Field Operations',
  verdict: 'near' as const,
  nearest_project: 'Lawley',
  distance_m: '312.4901',
  accuracy_m: '18.00',
  lat: '-26.3012345',
  lon: '27.8123456',
  selfie_url: 'https://app.fibreflow.app/storage/selfies/entry-1-in.jpg',
  device_fingerprint: 'fp-abc',
};

beforeEach(() => {
  sqlMock.query.mockReset();
  sqlMock.query.mockResolvedValue([structuredClone(FACT)]);
});

describe('runCheckinLocations', () => {
  it('returns no rows and an explicit note when the date range is missing', async () => {
    const result = await runCheckinLocations(input({ dateFrom: undefined }));
    expect(result.rows).toEqual([]);
    expect(result.notes).toEqual(['Date range is required.']);
    // The column set must survive so the export keeps a stable header.
    expect(result.columns.length).toBeGreaterThan(0);
    expect(sqlMock.query).not.toHaveBeenCalled();
  });

  it('maps a persisted event row onto the declared column keys', async () => {
    const result = await runCheckinLocations(input());
    expect(result.rows).toHaveLength(1);
    expect(Object.keys(result.rows[0]!)).toEqual(result.columns.map((c) => c.key));
    expect(result.rows[0]).toMatchObject({
      work_date: '2026-08-18',
      time_sast: '07:42',
      event: 'Clock in',
      staff: 'Alice Worker',
      verdict: 'near',
      nearest_project: 'Lawley',
      distance_m: 312,
      accuracy_m: 18,
      selfie_url: FACT.selfie_url,
      entry_id: 'entry-1',
    });
  });

  it('labels a clock-out event distinctly from a clock-in', async () => {
    sqlMock.query.mockResolvedValueOnce([{ ...FACT, event: 'out' }]);
    const result = await runCheckinLocations(input());
    expect(result.rows[0]).toMatchObject({ event: 'Clock out' });
  });

  it('keeps a missing GPS fix as a locatable-nothing row rather than dropping it', async () => {
    sqlMock.query.mockResolvedValueOnce([{
      ...FACT, verdict: 'no_gps', lat: null, lon: null,
      accuracy_m: null, distance_m: null, nearest_project: null,
    }]);
    const result = await runCheckinLocations(input());
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      verdict: 'no_gps', lat: '', lon: '', nearest_project: '',
      distance_m: null, accuracy_m: null,
    });
    expect(result.notes).toContain('1 event(s) carry no GPS fix and cannot be located.');
  });

  it('reports how many events had coordinates but no derivable AOI', async () => {
    sqlMock.query.mockResolvedValueOnce([
      { ...FACT, verdict: 'no_aoi', nearest_project: null, distance_m: null },
      { ...FACT, entry_id: 'entry-2', verdict: 'no_aoi', nearest_project: null, distance_m: null },
    ]);
    const result = await runCheckinLocations(input());
    expect(result.notes).toContain(
      '2 event(s) had coordinates but no project has enough poles to form an AOI.',
    );
    // ...and does NOT claim a GPS gap that isn't there.
    expect(result.notes.some((n) => n.includes('no GPS fix'))).toBe(false);
  });

  it('binds the date range, supervisor scope and row cap as parameters', async () => {
    await runCheckinLocations(input());
    const [text, params] = sqlMock.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([['staff-1'], '2026-07-20', '2026-08-18', REPORT_ROW_CAP + 1]);
    expect(text).toContain('e.staff_id = ANY($1::uuid[])');
    expect(text).toContain('e.work_date >= $2::date');
    expect(text).toContain('e.work_date <= $3::date');
  });

  it('appends the site filter after the base params so $N numbering stays aligned', async () => {
    await runCheckinLocations(input({ siteIds: ['11111111-1111-1111-1111-111111111111'] }));
    const [text, params] = sqlMock.query.mock.calls[0] as [string, unknown[]];
    expect(params[3]).toEqual(['11111111-1111-1111-1111-111111111111']);
    expect(text).toContain('e.site_geofence_id = ANY($4::uuid[])');
    // The cap moves to $5 — proof the builder, not a hard-coded index, owns numbering.
    expect(params[4]).toBe(REPORT_ROW_CAP + 1);
    expect(text).toContain(`LIMIT $5`);
  });

  it('measures distance against the pole hull, materialised and SA-bounded', async () => {
    await runCheckinLocations(input());
    const [text] = sqlMock.query.mock.calls[0] as [string];
    // MATERIALIZED is a performance contract, not a style choice: without it
    // Postgres re-aggregates every pole per event row (4.9s vs 107ms).
    expect(text).toContain('project_aoi AS MATERIALIZED');
    expect(text).toContain('ST_ConvexHull');
    expect(text).toContain(`p.latitude  BETWEEN ${SA_LAT_MIN}`);
    expect(text).toContain(`AND ${SA_LON_MAX}`);
    expect(text).toContain(`HAVING COUNT(*) >= ${MIN_POLES_FOR_AOI}`);
    // Not the empty fleet_authorized_locations table the geo-mismatch report uses.
    expect(text).not.toContain('fleet_authorized_locations');
  });

  it('classifies against the near threshold and the reported GPS error', async () => {
    await runCheckinLocations(input());
    const [text] = sqlMock.query.mock.calls[0] as [string];
    expect(text).toContain(`WHEN n.dist_m < ${NEAR_THRESHOLD_M}`);
    expect(text).toContain('WHEN n.dist_m <= COALESCE(ev.accuracy_m, 0)    THEN \'within_accuracy\'');
  });

  it('emits both clock events per entry from a single scan of the entries table', async () => {
    await runCheckinLocations(input());
    const [text] = sqlMock.query.mock.calls[0] as [string];
    expect(text).toContain('CROSS JOIN LATERAL (VALUES');
    expect(text).toContain("('in',  b.clock_in_at");
    expect(text).toContain("('out', b.clock_out_at");
    // One FROM attendance_entries — a UNION ALL rebuild would double-bind params.
    expect(text.match(/FROM attendance_entries/g)).toHaveLength(1);
  });

  it('throws before mapping when the result overflows the row cap', async () => {
    const overflow = Array.from({ length: REPORT_ROW_CAP + 1 }, (_, i) => ({
      ...FACT, entry_id: `entry-${i}`,
    }));
    sqlMock.query.mockResolvedValueOnce(overflow);
    await expect(runCheckinLocations(input())).rejects.toBeInstanceOf(ReportTooLargeError);
  });
});
