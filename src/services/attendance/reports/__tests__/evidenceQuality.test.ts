import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: { query: vi.fn() } }));
vi.mock('@/lib/db-pool', () => ({ sql: sqlMock }));

import { ReportTooLargeError } from '../runner';
import { runEvidenceQuality } from '../evidenceQuality';
import type { ReportInput } from '../types';

function input(scopedStaffIds: string[] | null): ReportInput {
  return {
    scopedStaffIds, hasAnyStaff: scopedStaffIds === null || scopedStaffIds.length > 0,
    scope: {} as ReportInput['scope'], dateFrom: '2026-07-01', dateTo: '2026-08-01',
    departments: [], siteIds: [], staffIdsHint: [],
  };
}

interface PointFixture {
  entry_id: string; check_type: 'in' | 'out'; has_gps: boolean; accuracy_m: number | null;
  has_selfie: boolean; site_geofence_id: string | null; cartrack_verdict: string | null;
  timestamp_unreliable: boolean; geofence_mismatch: boolean;
}

const MIXED_FACTS: Array<{
  staff_id: string; full_name: string; department: string; points: PointFixture[];
}> = [{
  staff_id: 'staff-1', full_name: 'Alice Worker', department: 'Build',
  points: [
    {
      entry_id: 'entry-1', check_type: 'in', has_gps: true, accuracy_m: 12,
      has_selfie: true, site_geofence_id: 'site-1', cartrack_verdict: 'match',
      timestamp_unreliable: true,
      geofence_mismatch: false,
    },
    {
      entry_id: 'entry-1', check_type: 'out', has_gps: true, accuracy_m: 18,
      has_selfie: true, site_geofence_id: 'site-1', cartrack_verdict: 'mismatch',
      timestamp_unreliable: true,
      geofence_mismatch: false,
    },
  ],
}];

beforeEach(() => {
  sqlMock.query.mockReset();
  sqlMock.query.mockResolvedValue(structuredClone(MIXED_FACTS));
});

describe('runEvidenceQuality', () => {
  it('keeps a timestamp exception separate from valid channel evidence', async () => {
    const result = await runEvidenceQuality(input(['staff-1']));
    expect(result.rows).toEqual([{
      worker: 'Alice Worker', department: 'Build', entry_count: 1,
      gps_available: 2, gps_unavailable: 0, gps_unreliable: 0,
      selfie_available: 2, selfie_unavailable: 0, selfie_unreliable: 0,
      geofence_available: 1, geofence_unavailable: 0, geofence_unreliable: 0,
      cartrack_available: 2, cartrack_unavailable: 0, cartrack_unreliable: 0,
      timestamp_unreliable_entries: 1, coverage_status: 'complete',
    }]);
    expect(JSON.stringify(result)).not.toMatch(/fraud|guilt|performance|payroll[_ -]?(?:approved|ready)|verified match/i);
    expect(Object.keys(result.rows[0] ?? {})).toEqual(result.columns.map((column) => column.key));
  });

  it('classifies channels from their own facts when a point mutates', async () => {
    const facts = structuredClone(MIXED_FACTS);
    facts[0]!.points[0]!.accuracy_m = 150;
    facts[0]!.points[0]!.has_selfie = false;
    facts[0]!.points[0]!.site_geofence_id = null;
    facts[0]!.points[0]!.cartrack_verdict = 'no_data';
    sqlMock.query.mockResolvedValueOnce(facts);

    const result = await runEvidenceQuality(input(null));
    expect(result.rows[0]).toMatchObject({
      gps_available: 1, gps_unreliable: 1,
      selfie_available: 1, selfie_unavailable: 1,
      geofence_available: 0, geofence_unavailable: 1,
      cartrack_available: 1, cartrack_unreliable: 1,
      timestamp_unreliable_entries: 1, coverage_status: 'unreliable',
    });
  });

  it('classifies geofence mismatch as unreliable from the persisted verdict fact', async () => {
    const facts = structuredClone(MIXED_FACTS);
    facts[0]!.points[0]!.geofence_mismatch = true;
    facts[0]!.points[0]!.timestamp_unreliable = false;
    facts[0]!.points[1]!.timestamp_unreliable = false;
    sqlMock.query.mockResolvedValueOnce(facts);

    const result = await runEvidenceQuality(input(['staff-1']));
    expect(result.rows[0]).toMatchObject({
      geofence_available: 0, geofence_unavailable: 0,
      geofence_unreliable: 1, timestamp_unreliable_entries: 0,
      coverage_status: 'unreliable',
    });
    const [query] = sqlMock.query.mock.calls[0] as [string, unknown[]];
    expect(query).toMatch(/attendance_exceptions[\s\S]*exception_kind\s*=\s*'geofence_mismatch'/i);
  });

  it('renders wholly unavailable channels as unavailable without sensitive URLs', async () => {
    sqlMock.query.mockResolvedValueOnce([{
      staff_id: 'staff-1', full_name: 'Alice Worker', department: 'Build',
      points: [{
        entry_id: 'entry-1', check_type: 'in', has_gps: false, accuracy_m: null,
        has_selfie: false, site_geofence_id: null, cartrack_verdict: null,
        timestamp_unreliable: false,
        geofence_mismatch: false,
      }],
    }]);
    const result = await runEvidenceQuality(input(['staff-1']));
    expect(result.rows[0]).toMatchObject({ coverage_status: 'unavailable', timestamp_unreliable_entries: 0 });
    expect(JSON.stringify(result.rows)).not.toMatch(/selfie.*url|storage|verified|fraud|payroll/i);
    expect(result.columns.some((column) => /payroll|fraud|verified/i.test(`${column.key} ${column.label}`))).toBe(false);
  });

  it('binds date and supervisor scope without inferring organisation access', async () => {
    await runEvidenceQuality(input(['staff-1']));
    const [query, params] = sqlMock.query.mock.calls[0] as [string, unknown[]];
    expect(query).toContain('e.staff_id = ANY($3::uuid[])');
    expect(params).toEqual(['2026-07-01', '2026-08-01', ['staff-1'], 50_001]);
    expect(query).toContain('s.join_date::date <= e.work_date');
    expect(query).toContain('s.end_date::date >= e.work_date');
  });

  it('returns no rows for an empty scope without querying', async () => {
    const result = await runEvidenceQuality(input([]));
    expect(result.rows).toEqual([]);
    expect(result.columns.length).toBeGreaterThan(0);
    expect(sqlMock.query).not.toHaveBeenCalled();
  });

  it('enforces the shared row cap', async () => {
    sqlMock.query.mockResolvedValueOnce(Array.from({ length: 50_001 }, (_, index) => ({
      ...MIXED_FACTS[0], staff_id: `staff-${index}`,
    })));
    await expect(runEvidenceQuality(input(null))).rejects.toBeInstanceOf(ReportTooLargeError);
  });
});
