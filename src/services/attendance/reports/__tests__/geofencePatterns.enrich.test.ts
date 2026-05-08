import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db-pool', () => ({
  sql: {
    query: vi.fn(),
  },
}));

import { sql } from '@/lib/db-pool';
import { runGeofencePatterns } from '../geofencePatterns';

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
        max_single_project_pct: 95,
        per_project_pct_json: '{"p1":95}',
      },
    ]);
    const result = await runGeofencePatterns({
      dateFrom: '2026-04-08', dateTo: '2026-05-08',
      departments: [], siteIds: [], scopedStaffIds: null,
    } as never);
    expect(result.rows[0]).toMatchObject({
      suggested_archetype: 'project',
      data_gap_no_assignments: 'yes',
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
        max_single_project_pct: 0,
        per_project_pct_json: '{}',
      },
    ]);
    const result = await runGeofencePatterns({
      dateFrom: '2026-04-08', dateTo: '2026-05-08',
      departments: [], siteIds: [], scopedStaffIds: null,
    } as never);
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
        distinct_polygons_hit: 0, max_single_project_pct: 0,
        per_project_pct_json: '{}',
      },
    ]);
    const result = await runGeofencePatterns({
      dateFrom: '2026-04-08', dateTo: '2026-05-08',
      departments: [], siteIds: [], scopedStaffIds: null,
    } as never);
    expect(result.rows[0]).toMatchObject({ low_signal: 'yes' });
  });
});
