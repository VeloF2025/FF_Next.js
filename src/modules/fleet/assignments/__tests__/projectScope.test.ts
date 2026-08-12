import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  userHasPermission: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => ({ query: mocks.query }));
vi.mock('@/lib/permissions', () => ({ userHasPermission: mocks.userHasPermission }));

import { canEditAssignmentProject } from '../projectScope';

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
