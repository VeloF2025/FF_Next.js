import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
  txnQuery: vi.fn(),
  txnQueryOne: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => ({
  query: mocks.query,
  transaction: mocks.transaction,
}));

import {
  ProjectSiteValidationError,
  createProjectSite,
  listProjectSites,
  updateProjectSite,
} from '../projectSiteQueries';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SITE_ID = '22222222-2222-4222-8222-222222222222';
const AOI_ID = '33333333-3333-4333-8333-333333333333';
const LOCATION_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555555';

const siteRow = {
  id: SITE_ID,
  project_id: PROJECT_ID,
  display_name: 'North depot',
  project_aoi_id: AOI_ID,
  authorized_location_id: null,
  is_default: true,
  is_active: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (work: (txn: unknown) => Promise<unknown>) => work({
    query: mocks.txnQuery,
    queryOne: mocks.txnQueryOne,
  }));
});

describe('listProjectSites', () => {
  it('excludes inactive sites unless they are explicitly requested', async () => {
    mocks.query.mockResolvedValue([siteRow]);

    await expect(listProjectSites(PROJECT_ID, false)).resolves.toEqual([{
      id: SITE_ID,
      projectId: PROJECT_ID,
      displayName: 'North depot',
      projectAoiId: AOI_ID,
      authorizedLocationId: null,
      isDefault: true,
      isActive: true,
    }]);
    expect(mocks.query.mock.calls[0]?.[0]).toContain('AND ops.is_active = true');

    await listProjectSites(PROJECT_ID, true);
    expect(mocks.query.mock.calls[1]?.[0]).not.toContain('AND ops.is_active = true');
  });
});

describe('createProjectSite', () => {
  it.each([
    ['neither source', null, null],
    ['both sources', AOI_ID, LOCATION_ID],
  ])('rejects %s before opening a transaction', async (_label, projectAoiId, authorizedLocationId) => {
    await expect(createProjectSite({
      projectId: PROJECT_ID,
      displayName: 'North depot',
      projectAoiId,
      authorizedLocationId,
      isDefault: false,
    }, { userId: USER_ID })).rejects.toBeInstanceOf(ProjectSiteValidationError);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects a retired AOI source', async () => {
    mocks.txnQueryOne.mockResolvedValueOnce(null);

    await expect(createProjectSite({
      projectId: PROJECT_ID,
      displayName: 'North depot',
      projectAoiId: AOI_ID,
      authorizedLocationId: null,
      isDefault: false,
    }, { userId: USER_ID })).rejects.toMatchObject({ code: 'inactive_source' });
    expect(mocks.txnQueryOne.mock.calls[0]?.[0]).toContain('retired_at IS NULL');
  });

  it('links an active AOI without reading or copying geometry and appends an audit row', async () => {
    mocks.txnQueryOne
      .mockResolvedValueOnce({ id: AOI_ID, site_code: 'AOI-7', area_name: 'North' })
      .mockResolvedValueOnce(siteRow);
    mocks.txnQuery.mockResolvedValue([]);

    await expect(createProjectSite({
      projectId: PROJECT_ID,
      displayName: 'North depot',
      projectAoiId: AOI_ID,
      authorizedLocationId: null,
      isDefault: false,
    }, { userId: USER_ID })).resolves.toMatchObject({ projectAoiId: AOI_ID });

    const sourceSql = mocks.txnQueryOne.mock.calls[0]?.[0] as string;
    const insertSql = mocks.txnQueryOne.mock.calls[1]?.[0] as string;
    expect(sourceSql).toContain('site_code, area_name');
    expect(sourceSql).not.toContain('geom');
    expect(insertSql).toContain('project_aoi_id');
    expect(mocks.txnQuery.mock.calls.at(-1)?.[0]).toContain('fleet_project_operational_site_audit');
    expect(mocks.txnQuery.mock.calls.at(-1)?.[1]).toContain(USER_ID);
  });

  it('links an active Authorized Location and snapshots its display name when none is supplied', async () => {
    mocks.txnQueryOne
      .mockResolvedValueOnce({ id: LOCATION_ID, name: 'Main office' })
      .mockResolvedValueOnce({ ...siteRow, display_name: 'Main office', project_aoi_id: null, authorized_location_id: LOCATION_ID });
    mocks.txnQuery.mockResolvedValue([]);

    await createProjectSite({
      projectId: PROJECT_ID,
      authorizedLocationId: LOCATION_ID,
      projectAoiId: null,
      isDefault: false,
    }, { userId: USER_ID });

    expect(mocks.txnQueryOne.mock.calls[0]?.[0]).toContain('fleet_authorized_locations');
    expect(mocks.txnQueryOne.mock.calls[0]?.[0]).toContain('is_active = true');
    expect(mocks.txnQueryOne.mock.calls[1]?.[1]).toContain('Main office');
  });

  it('locks active project sites and clears the prior default in the same transaction', async () => {
    mocks.txnQueryOne
      .mockResolvedValueOnce({ id: LOCATION_ID, name: 'Main office' })
      .mockResolvedValueOnce({ ...siteRow, project_aoi_id: null, authorized_location_id: LOCATION_ID });
    mocks.txnQuery.mockResolvedValue([]);

    await createProjectSite({
      projectId: PROJECT_ID,
      displayName: 'Main office',
      projectAoiId: null,
      authorizedLocationId: LOCATION_ID,
      isDefault: true,
    }, { userId: USER_ID });

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.txnQuery.mock.calls[0]?.[0]).toContain('FOR UPDATE');
    expect(mocks.txnQuery.mock.calls[1]?.[0]).toContain('SET is_default = false');
    expect(mocks.txnQuery.mock.invocationCallOrder[1]).toBeLessThan(mocks.txnQueryOne.mock.invocationCallOrder[1]!);
  });
});

describe('updateProjectSite', () => {
  it('soft-deactivates a site, clears its default, and audits the before and after snapshots', async () => {
    mocks.txnQueryOne
      .mockResolvedValueOnce(siteRow)
      .mockResolvedValueOnce({ ...siteRow, is_default: false, is_active: false });
    mocks.txnQuery.mockResolvedValue([]);

    await expect(updateProjectSite(SITE_ID, { isActive: false }, { userId: USER_ID }))
      .resolves.toMatchObject({ isActive: false, isDefault: false });

    expect(mocks.txnQueryOne.mock.calls[0]?.[0]).toContain('FOR UPDATE');
    expect(mocks.txnQueryOne.mock.calls[1]?.[0]).toContain('is_default = CASE');
    const auditCall = mocks.txnQuery.mock.calls.at(-1);
    expect(auditCall?.[0]).toContain('fleet_project_operational_site_audit');
    expect(auditCall?.[1]).toContain('deactivated');
    expect(auditCall?.[1]).toContain(USER_ID);
  });

  it('hands over the default after locking all active sites for the project', async () => {
    mocks.txnQueryOne
      .mockResolvedValueOnce({ ...siteRow, is_default: false })
      .mockResolvedValueOnce(siteRow);
    mocks.txnQuery.mockResolvedValue([]);

    await updateProjectSite(SITE_ID, { isDefault: true }, { userId: USER_ID });

    expect(mocks.txnQuery.mock.calls[0]?.[0]).toContain('FOR UPDATE');
    expect(mocks.txnQuery.mock.calls[1]?.[0]).toContain('SET is_default = false');
    expect(mocks.txnQuery.mock.calls.at(-1)?.[1]).toContain('default_changed');
  });
});
