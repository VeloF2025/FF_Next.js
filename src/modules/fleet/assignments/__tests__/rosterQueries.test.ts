import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: mocks.query }));

import { listAssignmentOptions, listAssignmentRoster } from '../rosterQueries';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => vi.clearAllMocks());

describe('listAssignmentRoster', () => {
  it('caps pagination and only reads active assignments for the requested project', async () => {
    mocks.query.mockResolvedValue([]);

    await listAssignmentRoster({ projectId: PROJECT_ID, siteId: '22222222-2222-4222-8222-222222222222', source: 'roster', limit: 1000, offset: 4 });

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("oa.status = 'active'");
    expect(sql).toContain('p.id = $1::uuid');
    expect(sql).toContain('ops.id = $2::uuid');
    expect(sql).toContain('oa.assignment_kind = $3');
    expect(sql).toContain('LIMIT $4 OFFSET $5');
    expect(sql).toContain('LEFT JOIN vehicle_assignments va ON va.id = oa.vehicle_assignment_id');
    expect(sql).not.toContain('CURRENT_DATE');
    expect(params).toEqual([PROJECT_ID, '22222222-2222-4222-8222-222222222222', 'roster', 100, 4]);
  });
});

describe('listAssignmentOptions', () => {
  it('returns no options without authorized projects', async () => {
    await expect(listAssignmentOptions({}, [])).resolves.toEqual({ staff: [], projects: [], sites: [], vehicles: [] });
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
    expect(params).toEqual([[PROJECT_ID], '2026-08-01', '2026-08-31']);
  });
});
