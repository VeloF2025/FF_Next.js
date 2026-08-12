import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveOperationalAssignment } from '../resolver';

const STAFF = '11111111-1111-4111-8111-111111111111';
const DATE = '2026-08-12';
const query = vi.fn();

const assignment = (kind: 'daily_override' | 'roster') => ({
  id: `${kind}-id`, project_id: `${kind}-project`, project_manager: 'manager',
  operational_site_id: `${kind}-site`, operational_site_name: `${kind} site`,
  authorized_location_id: `${kind}-location`, vehicle_assignment_id: null,
});
const schedule = { id: 'policy', start_time: '07:00', end_time: '16:00', scheduled: true, warning: null };

function rows(values: Partial<Record<string, unknown[]>>) {
  query.mockImplementation((sql: string) => {
    const marker = Object.keys(values).find((key) => sql.includes(`fleet-resolver:${key}`));
    return Promise.resolve(marker ? values[marker] : []);
  });
}

beforeEach(() => { vi.clearAllMocks(); rows({ schedule: [schedule] }); });

describe('resolveOperationalAssignment', () => {
  it('gives a daily override precedence over a roster row', async () => {
    rows({ daily: [assignment('daily_override')], roster: [assignment('roster')], schedule: [schedule] });
    expect(await resolveOperationalAssignment(STAFF, DATE, { query })).toMatchObject({ source: 'daily_override', projectId: 'daily_override-project' });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('fleet-resolver:roster'))).toBe(false);
  });

  it('gives a roster row precedence over vehicle evidence', async () => {
    rows({ roster: [assignment('roster')], vehicles: [{ id: 'va', vehicle_id: 'vehicle' }], schedule: [schedule] });
    expect(await resolveOperationalAssignment(STAFF, DATE, { query })).toMatchObject({ source: 'roster', projectId: 'roster-project' });
  });

  it('uses a unique effective vehicle project before home site', async () => {
    rows({ vehicles: [{ id: 'va', vehicle_id: 'vehicle' }], vehicleProjects: [{ id: 'vp', project_id: 'project', project_manager: 'pm', operational_site_id: 'site', operational_site_name: 'Site', authorized_location_id: 'location' }], homeSite: [{ id: 'home', display_name: 'Home' }], schedule: [schedule] });
    expect(await resolveOperationalAssignment(STAFF, DATE, { query })).toMatchObject({ source: 'vehicle_project', projectId: 'project', vehicleAssignmentId: 'va' });
  });

  it('uses an active home site with no project or manager', async () => {
    rows({ homeSite: [{ id: 'home', display_name: 'Depot' }], schedule: [schedule] });
    expect(await resolveOperationalAssignment(STAFF, DATE, { query })).toMatchObject({ source: 'home_site', projectId: null, projectManager: null, authorizedLocationId: 'home' });
  });

  it('returns unassigned when no evidence exists', async () => {
    rows({ schedule: [schedule] });
    expect(await resolveOperationalAssignment(STAFF, DATE, { query })).toMatchObject({ source: 'unassigned', projectId: null, warnings: [] });
  });

  it.each([
    ['driver vehicles', { vehicles: [{ id: 'va1', vehicle_id: 'v1' }, { id: 'va2', vehicle_id: 'v2' }] }, 'AMBIGUOUS_DRIVER_VEHICLES'],
    ['vehicle projects', { vehicles: [{ id: 'va', vehicle_id: 'v1' }], vehicleProjects: [{ id: 'vp1' }, { id: 'vp2' }] }, 'AMBIGUOUS_VEHICLE_PROJECTS'],
  ])('refuses ambiguous %s', async (_name, evidence, warning) => {
    rows({ ...evidence, schedule: [schedule] });
    expect(await resolveOperationalAssignment(STAFF, DATE, { query })).toMatchObject({ source: 'unassigned', warnings: [warning] });
  });

  it('ignores inactive source rows because every source query filters them', async () => {
    rows({
      schedule: [schedule],
      vehicles: [{ id: 'va', vehicle_id: 'vehicle' }],
    });
    await resolveOperationalAssignment(STAFF, DATE, { query });
    const sql = query.mock.calls.map(([text]) => String(text)).join('\n');
    expect(sql).toContain("foa.status = 'active'");
    expect(sql).toContain('fvpa.is_active = true');
    expect(sql).toContain('fal.is_active = true');
  });

  it('selects the effective schedule policy for the requested work date', async () => {
    rows({ schedule: [{ ...schedule, id: 'dated-policy' }] });
    expect(await resolveOperationalAssignment(STAFF, '2026-03-03', { query })).toMatchObject({ schedulePolicyId: 'dated-policy', expectedStartTime: '07:00', expectedEndTime: '16:00', scheduled: true });
    const call = query.mock.calls.find(([sql]) => String(sql).includes('fleet-resolver:schedule'));
    expect(call?.[1]).toEqual([STAFF, '2026-03-03']);
  });

  it.each(['SUNDAY', 'PUBLIC_HOLIDAY'])('keeps an unscheduled %s with a warning', async (warning) => {
    rows({ schedule: [{ ...schedule, scheduled: false, warning }] });
    expect(await resolveOperationalAssignment(STAFF, DATE, { query })).toMatchObject({ workDate: DATE, scheduled: false, warnings: [warning] });
  });
});
