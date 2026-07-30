import { describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/db-pool', () => ({ query }));

import { projectResolverRepo } from '../projectResolverRepo';

describe('projectResolverRepo', () => {
  it('parameterizes names and searches FibreFlow plus QField names literally', async () => {
    const identifier = `HT_Mahikeng%'`;

    await projectResolverRepo.findCandidates(identifier);

    const [sql, params] = query.mock.calls[0]!;
    expect(params).toEqual([identifier]);
    expect(sql).toContain('lower(qp.name) = lower($1)');
    expect(sql).toContain('position(lower($1) in lower(p.project_name))');
    expect(sql).toContain('position(lower($1) in lower(qp.name))');
    expect(sql).not.toContain(identifier);
  });
});
