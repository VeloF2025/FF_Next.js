import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: mocks.query }));

import { listAssignmentOptions, listAssignmentRoster } from '../rosterQueries';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => vi.clearAllMocks());

describe('listAssignmentRoster', () => {
  it('caps pagination and only reads active assignments for the requested project', async () => {
    mocks.query.mockResolvedValue([]);

    await listAssignmentRoster({ projectId: PROJECT_ID, limit: 1000, offset: 4 });

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("oa.status = 'active'");
    expect(sql).toContain('p.id = $1::uuid');
    expect(sql).toContain('LIMIT $2 OFFSET $3');
    expect(params).toEqual([PROJECT_ID, 100, 4]);
  });
});

describe('listAssignmentOptions', () => {
  it('returns no options without authorized projects', async () => {
    await expect(listAssignmentOptions({}, [])).resolves.toEqual({ staff: [], projects: [], sites: [], vehicles: [] });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('scopes options and limits vehicles to currently effective assignments', async () => {
    mocks.query.mockResolvedValue([]);

    await listAssignmentOptions({}, [PROJECT_ID]);

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('p.id = ANY($1::uuid[])');
    expect(sql).toContain("LOWER(COALESCE(s.status, '')) = 'active'");
    expect(sql).toContain('ops.is_active = true');
    expect(sql).toContain('va.assignment_start <= CURRENT_DATE');
    expect(sql).toContain("COALESCE(va.assignment_end, '9999-12-31'::date) >= CURRENT_DATE");
    expect(params).toEqual([[PROJECT_ID]]);
  });
});
