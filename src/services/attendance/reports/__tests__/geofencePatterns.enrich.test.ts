import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db-pool', () => ({
  sql: {
    query: vi.fn(),
  },
}));

import { sql } from '@/lib/db-pool';
import { runGeofencePatterns } from '../geofencePatterns';
import type { ReportInput } from '../types';

/**
 * Minimal stub for ReportInput. The runner only reads dateFrom/dateTo/
 * departments/scopedStaffIds; the other fields exist on the real type
 * (hasAnyStaff, scope, staffIdsHint, siteIds) but aren't touched by
 * runGeofencePatterns. Casting via `unknown` is intentional — we don't
 * want to construct a fake `ResolvedScope` for fields the function
 * doesn't read.
 */
function stubInput(overrides: Partial<ReportInput>): ReportInput {
  return {
    dateFrom: '2026-04-08',
    dateTo: '2026-05-08',
    departments: [],
    siteIds: [],
    scopedStaffIds: null,
    staffIdsHint: [],
    hasAnyStaff: true,
    ...overrides,
  } as unknown as ReportInput;
}

describe('runGeofencePatterns enrichment', () => {
  it('flags data_gap_no_assignments for a project-suggested staffer with no assignments', async () => {
    (sql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        staff_id: 'a', full_name: 'Alice A', department: 'Civil', home_site_id: null,
        active_assignment_count: 0,
        total_clock_ins: 20,
        inside_any_assigned: 19,
        inside_office: 0,
        unmatched: 1,
        distinct_polygons_hit: 1,
        per_project_hits_json: '{"p1":19}', // 19/20 = 95% — fires project rule
      },
    ]);
    const result = await runGeofencePatterns(stubInput({}));
    expect(result.rows[0]).toMatchObject({
      suggested_archetype: 'project',
      data_gap_no_assignments: 'yes',
      mismatch: 'no', // Civil's proposed default is 'project' too
    });
  });

  it('flags data_gap_no_home_site for an office-suggested staffer with NULL home_site_id', async () => {
    (sql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        staff_id: 'b', full_name: 'Bob B', department: 'Procurement', home_site_id: null,
        active_assignment_count: 0,
        total_clock_ins: 22,
        inside_any_assigned: 0,
        inside_office: 21,
        unmatched: 1,
        distinct_polygons_hit: 0,
        per_project_hits_json: '{}',
      },
    ]);
    const result = await runGeofencePatterns(stubInput({}));
    expect(result.rows[0]).toMatchObject({
      suggested_archetype: 'office',
      data_gap_no_home_site: 'yes',
    });
  });

  it('marks low_signal=yes when fewer than 5 clock-ins', async () => {
    (sql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        staff_id: 'c', full_name: 'Carla C', department: 'General', home_site_id: 'site-1',
        active_assignment_count: 0,
        total_clock_ins: 3, inside_any_assigned: 0, inside_office: 3, unmatched: 0,
        distinct_polygons_hit: 0,
        per_project_hits_json: '{}',
      },
    ]);
    const result = await runGeofencePatterns(stubInput({}));
    expect(result.rows[0]).toMatchObject({ low_signal: 'yes' });
  });

  it('flags mismatch=yes when suggested archetype differs from department default', async () => {
    // Civil's proposed default is 'project'. This staffer's clock-ins are
    // ALL inside an office, which makes the suggested archetype 'office' —
    // a real misclassification the report is designed to surface.
    (sql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        staff_id: 'd', full_name: 'Dan D', department: 'Civil', home_site_id: 'site-1',
        active_assignment_count: 1,
        total_clock_ins: 20,
        inside_any_assigned: 0,
        inside_office: 19,
        unmatched: 1,
        distinct_polygons_hit: 0,
        per_project_hits_json: '{}',
      },
    ]);
    const result = await runGeofencePatterns(stubInput({}));
    expect(result.rows[0]).toMatchObject({
      suggested_archetype: 'office',
      proposed_default_archetype: 'project',
      mismatch: 'yes',
    });
  });

  it('mismatch=no when suggested archetype equals the department default', async () => {
    // Civil + project-pattern data → both 'project' → mismatch=no.
    (sql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        staff_id: 'e', full_name: 'Erica E', department: 'Civil', home_site_id: null,
        active_assignment_count: 1,
        total_clock_ins: 20,
        inside_any_assigned: 19,
        inside_office: 0,
        unmatched: 1,
        distinct_polygons_hit: 1,
        per_project_hits_json: '{"p1":19}',
      },
    ]);
    const result = await runGeofencePatterns(stubInput({}));
    expect(result.rows[0]).toMatchObject({
      suggested_archetype: 'project',
      proposed_default_archetype: 'project',
      mismatch: 'no',
    });
  });

  it('handles per_project_hits_json as an already-parsed object (pg auto-parse path)', async () => {
    // The pg driver may auto-parse JSONB columns to JS objects depending on
    // pool config. The runner must handle both string and object inputs.
    // Three distinct projects each with >10% share → fires the mobile rule.
    (sql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        staff_id: 'f', full_name: 'Frank F', department: 'NOC', home_site_id: 'site-1',
        active_assignment_count: 3,
        total_clock_ins: 30,
        inside_any_assigned: 30,
        inside_office: 0,
        unmatched: 0,
        distinct_polygons_hit: 3,
        per_project_hits_json: { p1: 12, p2: 9, p3: 9 }, // object, not string
      },
    ]);
    const result = await runGeofencePatterns(stubInput({}));
    expect(result.rows[0]).toMatchObject({
      suggested_archetype: 'mobile',
      distinct_polygons_hit: 3,
    });
  });

  it('falls back to {} when per_project_hits_json is malformed JSON (does not throw)', async () => {
    (sql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        staff_id: 'g', full_name: 'Gail G', department: 'General', home_site_id: 'site-1',
        active_assignment_count: 0,
        total_clock_ins: 20,
        inside_any_assigned: 5,
        inside_office: 15,
        unmatched: 0,
        distinct_polygons_hit: 0,
        per_project_hits_json: '{not valid json',
      },
    ]);
    const result = await runGeofencePatterns(stubInput({}));
    // Should not throw. Office rule still fires because inside_office=15/20=75% (no, that's <80, so low_signal). Adjust expectation:
    // Actually 15/20 = 75%, below 80% office threshold, so low_signal=true.
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.staff).toBe('Gail G');
  });

  it('computes max_single_project_pct from raw hits + total (no SQL pre-computation)', async () => {
    // 18 hits in p1 out of 20 total = 90% — well above the 80% project threshold.
    (sql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        staff_id: 'h', full_name: 'Henry H', department: 'Civil', home_site_id: null,
        active_assignment_count: 1,
        total_clock_ins: 20,
        inside_any_assigned: 18,
        inside_office: 0,
        unmatched: 2,
        distinct_polygons_hit: 1,
        per_project_hits_json: '{"p1":18}',
      },
    ]);
    const result = await runGeofencePatterns(stubInput({}));
    expect(result.rows[0]).toMatchObject({
      max_single_project_pct: 90,
      suggested_archetype: 'project',
    });
  });
});
