import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: mocks.query }));

import { listAssignmentOptions, listAssignmentRoster } from '../rosterQueries';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

/**
 * listAssignmentRoster now resolves the day's expectation before building the
 * query — one call for the date list, one per date for the policy — so the
 * roster SQL is no longer the first call. Dispatch on the SQL rather than on
 * call order, and pick the roster call out by name.
 *
 * The policy row must carry the frozen production values: findEffectivePolicy
 * throws on anything else, by design.
 */
const POLICY_ROW = {
  id: 'policy-1', timezone: 'Africa/Johannesburg',
  weekday_start: '08:00', weekday_end: '17:00',
  weekday_unpaid_break_minutes: 60, weekday_paid_cap_hrs: '8',
  saturday_start: '08:00', saturday_end: '13:00', saturday_paid_cap_hrs: '5',
  sunday_scheduled: false, sunday_missing_out_cap_hrs: '5', late_alert_minutes: 15,
};

function mockRoster(rows: Record<string, unknown>[] = []): void {
  mocks.query.mockImplementation(async (text: string) => {
    // Order matters: the roster SQL also contains "AS work_date".
    if (text.includes('WITH staff_days AS')) return rows;
    if (text.includes('FROM attendance_schedule_policies')) return [POLICY_ROW];
    return [{ work_date: '2026-08-17' }];
  });
}

/** The roster statement, whichever call index it landed on. */
function rosterCall(): [string, unknown[]] {
  const call = mocks.query.mock.calls.find(([text]) => String(text).includes('WITH staff_days AS'));
  if (!call) throw new Error('roster query was never issued');
  return call as [string, unknown[]];
}

beforeEach(() => vi.clearAllMocks());

describe('listAssignmentRoster', () => {
  it('resolves effective assignments for scheduled staff in the requested project', async () => {
    mockRoster();

    await listAssignmentRoster({ projectId: PROJECT_ID, siteId: '22222222-2222-4222-8222-222222222222', source: 'roster', limit: 1000, offset: 4 });

    const [sql, params] = rosterCall();
    expect(sql).toContain('generate_series'); expect(sql).toContain("THEN 'vehicle_project'");
    expect(sql).toContain("WHEN home.id IS NOT NULL THEN 'home_site' ELSE 'unassigned'");
    // The expectation is joined from resolved parameters, never from the two
    // relations that never existed.
    expect(sql).toContain('policy_days'); expect(sql).toContain('sd.attendance_tracked');
    expect(sql).not.toContain('attendance_policy_assignments');
    expect(sql).toContain('effective.project_id = $1');
    expect(params).toEqual([PROJECT_ID, '22222222-2222-4222-8222-222222222222', 'roster', null, null,
      ['2026-08-17'], [true], ['08:00'], ['17:00'], 100, 4]);
  });

  it('returns only scheduled unassigned staff when requested', async () => {
    mockRoster();
    await listAssignmentRoster({ projectId: PROJECT_ID, source: 'unassigned', unassignedScheduled: true, startDate: '2026-08-17', endDate: '2026-08-17' });
    const [sql, params] = rosterCall();
    expect(sql).toContain("effective.source = 'unassigned'"); expect(sql).toContain('effective.scheduled = true');
    expect(sql).toContain("effective.project_id = $1::uuid OR effective.source = 'unassigned'");
    expect(sql).toContain('project_team_assignments');
    // 2026-08-17 is a Monday, so the weekday window is the expectation.
    expect(params).toEqual([PROJECT_ID, 'unassigned', '2026-08-17', '2026-08-17',
      ['2026-08-17'], [true], ['08:00'], ['17:00'], 25, 0]);
  });

  it('maps effective and unassigned execution rows with schedule context', async () => {
    mockRoster([
      { assignment_id: 'assignment-1', staff_id: 'staff-1', staff_name: 'Driver One', project_id: PROJECT_ID, project_name: 'Project One', operational_site_id: 'site-1', operational_site_name: 'Site One', start_date: '2026-08-17', end_date: '2026-08-21', assignment_kind: 'daily_override', vehicle_assignment_id: null, vehicle_registration: null, total_count: 2, work_date: '2026-08-17', scheduled: true, expected_start_time: '08:00:00', expected_end_time: '17:00:00' },
      { assignment_id: null, staff_id: 'staff-2', staff_name: 'Driver Two', project_id: null, project_name: null, operational_site_id: null, operational_site_name: null, start_date: null, end_date: null, assignment_kind: 'unassigned', vehicle_assignment_id: null, vehicle_registration: null, total_count: 2, work_date: '2026-08-17', scheduled: true, expected_start_time: '08:00:00', expected_end_time: '17:00:00' },
    ]);

    const result = await listAssignmentRoster({ projectId: PROJECT_ID, startDate: '2026-08-17', endDate: '2026-08-17' });

    expect(result.total).toBe(2);
    expect(result.items).toEqual([
      expect.objectContaining({ assignmentId: 'assignment-1', assignmentKind: 'daily_override', workDate: '2026-08-17', scheduled: true, expectedStartTime: '08:00:00' }),
      expect.objectContaining({ assignmentId: null, projectId: null, assignmentKind: 'unassigned', workDate: '2026-08-17', scheduled: true }),
    ]);
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
