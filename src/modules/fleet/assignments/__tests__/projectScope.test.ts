import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  userHasPermission: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => ({ query: mocks.query }));
vi.mock('@/lib/permissions', () => ({ userHasPermission: mocks.userHasPermission }));

import { authorizedAssignmentProjectIds, canEditAssignmentProject } from '../projectScope';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const STAFF_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userHasPermission.mockResolvedValue(true);
  mocks.query.mockResolvedValue([{ project_manager: STAFF_ID }]);
});

describe('canEditAssignmentProject', () => {
  it('allows an explicit fleet.assignments all-project oversight grant', async () => {
    mocks.query.mockResolvedValueOnce([{ project_manager: 'another-manager' }])
      .mockResolvedValueOnce([{ id: USER_ID }]);

    await expect(canEditAssignmentProject(USER_ID, STAFF_ID, 'manager', PROJECT_ID)).resolves.toBe(true);
    expect(mocks.userHasPermission).toHaveBeenCalledWith(USER_ID, 'fleet.assignments', 'edit');
  });

  it('allows a project manager whose user or staff identity owns the project', async () => {
    await expect(canEditAssignmentProject(USER_ID, STAFF_ID, 'project_manager', PROJECT_ID)).resolves.toBe(true);

    mocks.query.mockResolvedValueOnce([{ project_manager: USER_ID }])
      .mockResolvedValueOnce([]);
    await expect(canEditAssignmentProject(USER_ID, STAFF_ID, 'project_manager', PROJECT_ID)).resolves.toBe(true);
  });

  it('denies a project manager for another project', async () => {
    mocks.query.mockResolvedValueOnce([{ project_manager: 'another-manager' }])
      .mockResolvedValueOnce([]);

    await expect(canEditAssignmentProject(USER_ID, STAFF_ID, 'project_manager', PROJECT_ID)).resolves.toBe(false);
  });

  it('does not grant cross-project access from the generic manager role', async () => {
    mocks.query.mockResolvedValueOnce([{ project_manager: 'another-manager' }])
      .mockResolvedValueOnce([]);

    await expect(canEditAssignmentProject(USER_ID, STAFF_ID, 'manager', PROJECT_ID)).resolves.toBe(false);
  });

  it('denies inactive and missing projects', async () => {
    mocks.query.mockResolvedValueOnce([]);
    await expect(canEditAssignmentProject(USER_ID, STAFF_ID, 'admin', PROJECT_ID)).resolves.toBe(false);

    mocks.query.mockResolvedValueOnce([]);
    await expect(canEditAssignmentProject(USER_ID, STAFF_ID, 'manager', PROJECT_ID)).resolves.toBe(false);
  });
});

// The options endpoint used to call canViewAssignmentProject once per active
// project — 3 queries each. This batches to a fixed 3, so it has to reproduce
// the same allow/deny rules rather than approximate them.
describe('authorizedAssignmentProjectIds', () => {
  const OTHER_PROJECT = '44444444-4444-4444-8444-444444444444';
  const activeProjects = [
    { id: PROJECT_ID, project_manager: STAFF_ID },
    { id: OTHER_PROJECT, project_manager: 'someone-else' },
  ];

  it('returns nothing when the actor lacks the module permission', async () => {
    mocks.userHasPermission.mockResolvedValue(false);

    await expect(authorizedAssignmentProjectIds(USER_ID, STAFF_ID, 'manager', 'view')).resolves.toEqual([]);
    // Positive pin on WHY it is empty: it short-circuited before querying at
    // all, rather than querying and filtering everything out.
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('returns every active project for admin and super_admin', async () => {
    for (const role of ['admin', 'super_admin']) {
      mocks.query.mockReset().mockResolvedValueOnce(activeProjects);
      await expect(authorizedAssignmentProjectIds(USER_ID, STAFF_ID, role, 'view'))
        .resolves.toEqual([PROJECT_ID, OTHER_PROJECT]);
      // One query, not one per project, and no overrides lookup for a bypass role.
      expect(mocks.query).toHaveBeenCalledTimes(1);
    }
  });

  it('returns every active project for an explicit oversight grant', async () => {
    mocks.query.mockReset()
      .mockResolvedValueOnce(activeProjects)
      .mockResolvedValueOnce([{ id: USER_ID }]);

    await expect(authorizedAssignmentProjectIds(USER_ID, STAFF_ID, 'manager', 'view'))
      .resolves.toEqual([PROJECT_ID, OTHER_PROJECT]);
  });

  it('returns only the projects a manager owns by user or staff identity', async () => {
    mocks.query.mockReset()
      .mockResolvedValueOnce(activeProjects)
      .mockResolvedValueOnce([]);
    await expect(authorizedAssignmentProjectIds(USER_ID, STAFF_ID, 'project_manager', 'view'))
      .resolves.toEqual([PROJECT_ID]);

    mocks.query.mockReset()
      .mockResolvedValueOnce([{ id: OTHER_PROJECT, project_manager: USER_ID }])
      .mockResolvedValueOnce([]);
    await expect(authorizedAssignmentProjectIds(USER_ID, STAFF_ID, 'project_manager', 'view'))
      .resolves.toEqual([OTHER_PROJECT]);
  });

  it('stays at a fixed query count as the project list grows', async () => {
    const many = Array.from({ length: 50 }, (_, index) => ({ id: `p-${index}`, project_manager: 'someone-else' }));
    mocks.query.mockReset()
      .mockResolvedValueOnce(many)
      .mockResolvedValueOnce([]);

    await expect(authorizedAssignmentProjectIds(USER_ID, STAFF_ID, 'manager', 'view')).resolves.toEqual([]);
    // 50 projects, still 2 queries (projects + overrides). The loop this
    // replaced would have issued 150.
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it('passes the requested action through to the permission and override checks', async () => {
    mocks.query.mockReset()
      .mockResolvedValueOnce(activeProjects)
      .mockResolvedValueOnce([]);

    await authorizedAssignmentProjectIds(USER_ID, STAFF_ID, 'manager', 'edit');

    expect(mocks.userHasPermission).toHaveBeenCalledWith(USER_ID, 'fleet.assignments', 'edit');
    expect(mocks.query.mock.calls[1]![1]).toEqual([USER_ID, 'edit']);
  });
});
