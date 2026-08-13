import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ permission: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/permissions', () => ({ userHasPermission: mocks.permission }));
vi.mock('@/lib/db-pool', () => ({ query: mocks.query }));

import { canAccessOperationalProject, hasOperationalOversight } from '../projectScope';

describe('operational project scope', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.permission.mockResolvedValue(true); });

  it('allows a project manager only for their own active project', async () => {
    mocks.query.mockResolvedValueOnce([{ project_manager: 'staff-1' }]).mockResolvedValueOnce([]);
    await expect(canAccessOperationalProject('user-1', 'staff-1', 'manager', 'project-1')).resolves.toBe(true);
    mocks.query.mockResolvedValueOnce([{ project_manager: 'someone-else' }]).mockResolvedValueOnce([]);
    await expect(canAccessOperationalProject('user-1', 'staff-1', 'manager', 'project-2')).resolves.toBe(false);
  });

  it('allows admins and active explicit grants but not a generic manager', async () => {
    mocks.query.mockResolvedValue([{ project_manager: 'someone-else' }]);
    await expect(canAccessOperationalProject('admin', null, 'admin', 'project-1')).resolves.toBe(true);
    mocks.query.mockReset().mockResolvedValueOnce([{ project_manager: 'someone-else' }]);
    await expect(canAccessOperationalProject('super', null, 'super_admin', 'project-1')).resolves.toBe(true);
    mocks.query.mockReset().mockResolvedValueOnce([{ project_manager: 'someone-else' }]).mockResolvedValueOnce([{ id: 'grant' }]);
    await expect(canAccessOperationalProject('user-1', null, 'manager', 'project-1')).resolves.toBe(true);
    expect(String(mocks.query.mock.calls[1]?.[0])).toMatch(/expires_at IS NULL OR expires_at > NOW\(\)/);
  });

  it('denies a generic manager without ownership or an explicit grant', async () => {
    mocks.query.mockResolvedValueOnce([{ project_manager: 'someone-else' }]).mockResolvedValueOnce([]);
    await expect(canAccessOperationalProject('user-1', null, 'manager', 'project-1')).resolves.toBe(false);
  });

  it('requires explicit oversight when there is no project', async () => {
    mocks.query.mockResolvedValueOnce([]);
    await expect(hasOperationalOversight('user-1', 'manager')).resolves.toBe(false);
    mocks.query.mockResolvedValueOnce([{ id: 'grant' }]);
    await expect(hasOperationalOversight('user-1', 'manager')).resolves.toBe(true);
    await expect(hasOperationalOversight('admin', 'super_admin')).resolves.toBe(true);
  });

  it('fails closed when the base permission is absent', async () => {
    mocks.permission.mockResolvedValue(false);
    await expect(canAccessOperationalProject('user-1', 'staff-1', 'manager', 'project-1')).resolves.toBe(false);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
