import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: db.query, queryOne: db.queryOne }));

const permissions = vi.hoisted(() => ({ userHasPermission: vi.fn() }));
vi.mock('@/lib/permissions', () => ({ userHasPermission: permissions.userHasPermission }));

import { hasIncidentOversight, hasIncidentSettingsAccess, isActiveFibreFlowUser, isProjectOwnedByScope, resolveIncidentScope } from '../reviewScope';

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';

beforeEach(() => { vi.clearAllMocks(); db.query.mockResolvedValue([]); db.queryOne.mockResolvedValue(null); permissions.userHasPermission.mockResolvedValue(false); });

describe('hasIncidentOversight', () => {
  it('denies without the base fleet.incidents permission', async () => {
    permissions.userHasPermission.mockResolvedValue(false);
    expect(await hasIncidentOversight(USER, 'manager', 'view')).toBe(false);
  });

  it('grants admin roles automatically', async () => {
    permissions.userHasPermission.mockResolvedValue(true);
    expect(await hasIncidentOversight(USER, 'admin', 'view')).toBe(true);
    expect(await hasIncidentOversight(USER, 'super_admin', 'edit')).toBe(true);
  });

  it('denies a generic manager role without an active override grant', async () => {
    permissions.userHasPermission.mockResolvedValue(true);
    db.query.mockResolvedValue([]);
    expect(await hasIncidentOversight(USER, 'manager', 'view')).toBe(false);
  });

  it('grants a non-admin user with an active override grant', async () => {
    permissions.userHasPermission.mockResolvedValue(true);
    db.query.mockResolvedValue([{ id: 'grant-1' }]);
    expect(await hasIncidentOversight(USER, 'manager', 'view')).toBe(true);
  });
});

describe('hasIncidentSettingsAccess', () => {
  it('checks the fleet.incidents-settings permission independently of fleet.incidents', async () => {
    permissions.userHasPermission.mockResolvedValue(true);
    await hasIncidentSettingsAccess(USER, 'admin', 'edit');
    expect(permissions.userHasPermission).toHaveBeenCalledWith(USER, 'fleet.incidents-settings', 'edit');
  });
});

describe('resolveIncidentScope', () => {
  it('returns null without the base permission', async () => {
    permissions.userHasPermission.mockResolvedValue(false);
    expect(await resolveIncidentScope(USER, STAFF, 'manager', 'view')).toBeNull();
  });

  it('marks admin/oversight users unrestricted', async () => {
    permissions.userHasPermission.mockResolvedValue(true);
    const scope = await resolveIncidentScope(USER, STAFF, 'admin', 'view');
    expect(scope).toMatchObject({ unrestricted: true, pmUserId: USER, pmStaffId: STAFF });
  });

  it('marks a generic manager role restricted to owned projects', async () => {
    permissions.userHasPermission.mockResolvedValue(true);
    db.query.mockResolvedValue([]);
    const scope = await resolveIncidentScope(USER, STAFF, 'manager', 'view');
    expect(scope).toMatchObject({ unrestricted: false });
  });
});

describe('isProjectOwnedByScope', () => {
  it('always allows an unrestricted scope, even for a null project', async () => {
    expect(await isProjectOwnedByScope({ unrestricted: true, pmUserId: USER, pmStaffId: STAFF }, null)).toBe(true);
  });

  it('denies a restricted scope for a projectless incident', async () => {
    expect(await isProjectOwnedByScope({ unrestricted: false, pmUserId: USER, pmStaffId: STAFF }, null)).toBe(false);
  });

  it('denies a restricted scope for a project this user does not manage', async () => {
    db.query.mockResolvedValue([{ project_manager: 'someone-else' }]);
    expect(await isProjectOwnedByScope({ unrestricted: false, pmUserId: USER, pmStaffId: STAFF }, PROJECT)).toBe(false);
  });

  it('allows a restricted scope when the project manager matches the user or staff id', async () => {
    db.query.mockResolvedValue([{ project_manager: USER }]);
    expect(await isProjectOwnedByScope({ unrestricted: false, pmUserId: USER, pmStaffId: STAFF }, PROJECT)).toBe(true);
    db.query.mockResolvedValue([{ project_manager: STAFF }]);
    expect(await isProjectOwnedByScope({ unrestricted: false, pmUserId: USER, pmStaffId: STAFF }, PROJECT)).toBe(true);
  });
});

describe('isActiveFibreFlowUser', () => {
  it('resolves true only for an active user row', async () => {
    db.queryOne.mockResolvedValue({ id: USER });
    expect(await isActiveFibreFlowUser(USER)).toBe(true);
    db.queryOne.mockResolvedValue(null);
    expect(await isActiveFibreFlowUser(USER)).toBe(false);
  });
});
