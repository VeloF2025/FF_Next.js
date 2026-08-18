import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: { query: vi.fn() } }));
vi.mock('@/lib/db-pool', () => ({ sql: sqlMock }));

import { runCheckinLocations, NEAR_THRESHOLD_M } from '../checkinLocations';
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
  selfie_available: true,
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
      selfie: '/api/staff/attendance-selfie?entryId=entry-1&kind=in&context=checkin-locations',
      entry_id: 'entry-1',
      lat: -26.3012345,
      lon: 27.8123456,
    });
  });

  it('labels a clock-out event distinctly from a clock-in', async () => {
    sqlMock.query.mockResolvedValueOnce([{ ...FACT, event: 'out' }]);
    const result = await runCheckinLocations(input());
    expect(result.rows[0]).toMatchObject({
      event: 'Clock out',
      // The link's kind must follow the event, or it resolves the wrong selfie.
      selfie: '/api/staff/attendance-selfie?entryId=entry-1&kind=out&context=checkin-locations',
    });
  });

  it('leaves the selfie cell empty when the event captured none', async () => {
    sqlMock.query.mockResolvedValueOnce([{ ...FACT, selfie_available: false }]);
    const result = await runCheckinLocations(input());
    expect(result.rows[0]).toMatchObject({ selfie: '' });
  });

  it('never emits a raw storage URL for a selfie', async () => {
    // The /storage/ proxy serves attendance selfies with no cookie, so a raw
    // URL in an exportable report is unauthenticated access to biometrics.
    // Selfies must resolve through the RBAC-checked, access-logged API route.
    const result = await runCheckinLocations(input());
    const [text] = sqlMock.query.mock.calls[0] as [string];
    // The URL is reduced to a boolean in SQL, so it never reaches this layer.
    expect(text).toContain('IS NOT NULL AS selfie_available');

    for (const row of result.rows) {
      for (const value of Object.values(row)) {
        expect(String(value)).not.toContain('/storage/');
      }
    }
    expect(result.rows[0]!.selfie).toContain('/api/staff/attendance-selfie?');
  });

  it('keeps a missing GPS fix as a locatable-nothing row rather than dropping it', async () => {
    sqlMock.query.mockResolvedValueOnce([{
      ...FACT, verdict: 'no_gps', lat: null, lon: null,
      accuracy_m: null, distance_m: null, nearest_project: null,
    }]);
    const result = await runCheckinLocations(input());
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      verdict: 'no_gps', lat: null, lon: null, nearest_project: '',
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

  it('emits coordinates as numbers so the CSV guard cannot text-escape them', async () => {
    const result = await runCheckinLocations(input());
    // A string '-26.30…' trips the leading-'-' formula guard in
    // exportSerializers and reaches Excel as text, unusable on a map.
    expect(typeof result.rows[0]!.lat).toBe('number');
    expect(typeof result.rows[0]!.lon).toBe('number');
    // Full precision retained — a 'number' format would round to 2dp (~1km).
    expect(result.rows[0]!.lat).toBe(-26.3012345);
    const latCol = result.columns.find((c) => c.key === 'lat');
    expect(latCol?.format).toBeUndefined();
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

  it('reads the stored AOI table rather than rebuilding the hulls', async () => {
    await runCheckinLocations(input());
    const [text] = sqlMock.query.mock.calls[0] as [string];
    expect(text).toContain('FROM project_aois');
    // Building the hulls here would be a SECOND definition of the geometry the
    // clock-in path already records against, free to disagree about which
    // sites exist. It is also 25x slower (105ms vs 4.2ms per lookup).
    expect(text).not.toContain('ST_ConvexHull');
    expect(text).not.toContain('FROM poles');
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

  it('refuses to attribute a project to an event with no coordinates', async () => {
    await runCheckinLocations(input());
    const [text] = sqlMock.query.mock.calls[0] as [string];
    // Without this clause ST_Distance is NULL for every project, ORDER BY
    // ... LIMIT 1 picks an arbitrary one, and a no_gps row displays a site
    // it was never near. Confirmed against the live DB — it returned
    // 'Lawley' for a NULL-coordinate event.
    expect(text).toContain('WHERE ev.lat IS NOT NULL AND ev.lon IS NOT NULL');
    // Pin WHY it matters: the guard sits inside the nearest-project LATERAL,
    // not in the outer CASE that only selects the verdict string.
    const lateral = text.slice(text.indexOf('LEFT JOIN LATERAL'));
    expect(lateral).toContain('ev.lat IS NOT NULL');
    expect(lateral).toContain('ORDER BY 2 ASC');
  });

  it('throws before mapping when the result overflows the row cap', async () => {
    const overflow = Array.from({ length: REPORT_ROW_CAP + 1 }, (_, i) => ({
      ...FACT, entry_id: `entry-${i}`,
    }));
    sqlMock.query.mockResolvedValueOnce(overflow);
    await expect(runCheckinLocations(input())).rejects.toBeInstanceOf(ReportTooLargeError);
  });
});
