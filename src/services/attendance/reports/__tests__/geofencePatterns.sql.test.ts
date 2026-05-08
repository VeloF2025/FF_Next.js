import { describe, it, expect } from 'vitest';
import { buildGeofencePatternsSql } from '../geofencePatterns';

describe('geofencePatterns SQL shape', () => {
  it('builds a CTE-based query referencing all required tables', () => {
    const { text } = buildGeofencePatternsSql({
      dateFrom: '2026-04-08',
      dateTo: '2026-05-08',
      departments: [],
      scopedStaffIds: null,
    });

    expect(text).toMatch(/WITH\s+/);
    expect(text).toMatch(/clock_ins\s+AS/);
    expect(text).toMatch(/per_staff_polygon_hits\s+AS/);
    expect(text).toMatch(/per_staff_office_hits\s+AS/);

    expect(text).toMatch(/\battendance_entries\b/);
    expect(text).toMatch(/\bstaff\b/);
    expect(text).toMatch(/\bstaff_projects\b/);
    expect(text).toMatch(/\bzone_boundaries\b/);
    expect(text).toMatch(/\bfleet_authorized_locations\b/);

    expect(text).toMatch(/ST_Contains\s*\(\s*zb\.geom/i);
    expect(text).toMatch(/location_type\s*=\s*'office'/);
    expect(text).toMatch(/sp\.is_active\s*=\s*true/);
  });

  it('parameterises departments and date range', () => {
    const { text, params } = buildGeofencePatternsSql({
      dateFrom: '2026-04-08',
      dateTo: '2026-05-08',
      departments: ['Civil', 'Optical'],
      scopedStaffIds: null,
    });
    expect(params).toContain('2026-04-08');
    expect(params).toContain('2026-05-08');
    expect(params.some((p: unknown) => Array.isArray(p) && (p as string[]).includes('Civil'))).toBe(true);
    expect(text).toMatch(/s\.department\s*=\s*ANY\s*\(\s*\$\d+::text\[\]\s*\)/);
  });

  it('omits the department filter when none are supplied', () => {
    const { text } = buildGeofencePatternsSql({
      dateFrom: '2026-04-08',
      dateTo: '2026-05-08',
      departments: [],
      scopedStaffIds: null,
    });
    expect(text).not.toMatch(/s\.department\s*=\s*ANY/);
  });

  it('emits a staff-scope filter when scopedStaffIds is non-null', () => {
    const ids = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'];
    const { text, params } = buildGeofencePatternsSql({
      dateFrom: '2026-04-08',
      dateTo: '2026-05-08',
      departments: [],
      scopedStaffIds: ids,
    });
    expect(text).toMatch(/s\.id\s*=\s*ANY\s*\(\s*\$\d+::uuid\[\]\s*\)/);
    expect(params).toContainEqual(ids);
  });

  it('returns aggregated raw hits (not pre-computed percentages) so TS does the math', () => {
    // Per the post-review fix, the SQL should NOT reference COUNT(*) OVER ()
    // (which counted projects-hit, not total clock-ins) and should not return
    // max_single_project_pct from SQL. Instead it returns per_project_hits_json
    // and the runner computes percentages against total_clock_ins.
    const { text } = buildGeofencePatternsSql({
      dateFrom: '2026-04-08',
      dateTo: '2026-05-08',
      departments: [],
      scopedStaffIds: null,
    });
    expect(text).toMatch(/per_project_hits_json/);
    expect(text).not.toMatch(/COUNT\(\*\)\s+OVER\s*\(\s*\)/);
    expect(text).not.toMatch(/max_single_project_pct/);
  });
});
