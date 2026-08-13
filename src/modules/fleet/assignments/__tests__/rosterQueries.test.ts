import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: mocks.query }));

import { listAssignmentOptions, listAssignmentRoster } from '../rosterQueries';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => vi.clearAllMocks());

describe('listAssignmentRoster', () => {
  it('resolves effective assignments for scheduled staff in the requested project', async () => {
    mocks.query.mockResolvedValue([]);

    await listAssignmentRoster({ projectId: PROJECT_ID, siteId: '22222222-2222-4222-8222-222222222222', source: 'roster', limit: 1000, offset: 4 });

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('generate_series'); expect(sql).toContain("THEN 'vehicle_project'");
    expect(sql).toContain("WHEN home.id IS NOT NULL THEN 'home_site' ELSE 'unassigned'");
    expect(sql).toContain('attendance_policy_assignments'); expect(sql).toContain('effective.project_id = $1');
    expect(params).toEqual([PROJECT_ID, '22222222-2222-4222-8222-222222222222', 'roster', null, null, 100, 4]);
  });

  it('returns only scheduled unassigned staff when requested', async () => {
    mocks.query.mockResolvedValue([]);
    await listAssignmentRoster({ projectId: PROJECT_ID, source: 'unassigned', unassignedScheduled: true, startDate: '2026-08-17', endDate: '2026-08-17' });
    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("effective.source = 'unassigned'"); expect(sql).toContain('effective.scheduled = true');
    expect(sql).toContain("effective.project_id = $1::uuid OR effective.source = 'unassigned'");
    expect(sql).toContain('project_team_assignments');
    expect(params).toEqual([PROJECT_ID, 'unassigned', '2026-08-17', '2026-08-17', 25, 0]);
  });
});

describe('listAssignmentOptions', () => {
  it('returns no options without authorized projects', async () => {
    await expect(listAssignmentOptions({}, [])).resolves.toEqual({ staff: [], teams: [], projects: [], sites: [], vehicles: [], siteSources: [] });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('scopes options and limits vehicles to assignments covering the requested range', async () => {
    mocks.query.mockResolvedValue([]);

    await listAssignmentOptions({ startDate: '2026-08-01', endDate: '2026-08-31' }, [PROJECT_ID]);

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('p.id = ANY($1::uuid[])');
    expect(sql).toContain("LOWER(COALESCE(s.status, '')) = 'active'");
    expect(sql).toContain('ops.is_active = true');
    expect(sql).toContain('va.assignment_start <= $2::date');
    expect(sql).toContain("COALESCE(va.assignment_end, '9999-12-31'::date) >= $3::date");
    expect(sql).toContain('fvpa.assigned_date <= $2::date');
    expect(sql).toContain("COALESCE(fvpa.returned_date, '9999-12-31'::date) >= $3::date");
    expect(sql).not.toContain('CURRENT_DATE');
    expect(sql).toContain("'staffId', va.staff_id");
    expect(sql).toContain('fno_atlas_project_aois'); expect(sql).toContain('fleet_authorized_locations');
    expect(params).toEqual([[PROJECT_ID], '2026-08-01', '2026-08-31']);
  });
});
