import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({ default: { query: vi.fn() } }));

import pool from '@/lib/db';
const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };

describe('GET /api/activate/projects', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns distinct projects from oes_pp_data', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ project: 'Lawley' }, { project: 'Mamelodi' }, { project: 'Mohadin' }],
    });
    const { getDistinctProjects } = await import('@/modules/activate/services/projectsService');
    const result = await getDistinctProjects();
    expect(result).toEqual(['Lawley', 'Mamelodi', 'Mohadin']);
  });
});
