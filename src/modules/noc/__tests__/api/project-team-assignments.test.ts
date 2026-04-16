import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
vi.mock('@/modules/noc/utils/db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
}));

describe('project-team-assignments API logic', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('GET returns all assignments with project and team names', async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 'pta-1', project_id: 'proj-1', team_id: 'team-1', role: 'activations', created_at: '2026-04-16T00:00:00Z', project_name: 'Lawley', team_name: 'Lawley Activations' },
    ]);
    const { listProjectTeamAssignments } = await import('@/modules/noc/services/projectTeamAssignmentService');
    const result = await listProjectTeamAssignments();
    expect(result).toHaveLength(1);
    expect(result[0].project_name).toBe('Lawley');
    expect(result[0].role).toBe('activations');
  });

  it('createProjectTeamAssignment inserts and returns row', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'new-id', project_id: 'p1', team_id: 't1', role: 'activations', created_at: '2026-04-16T00:00:00Z' });
    const { createProjectTeamAssignment } = await import('@/modules/noc/services/projectTeamAssignmentService');
    const result = await createProjectTeamAssignment({ project_id: 'p1', team_id: 't1', role: 'activations' });
    expect(result.id).toBe('new-id');
  });

  it('deleteProjectTeamAssignment removes row by id', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'pta-1' }]);
    const { deleteProjectTeamAssignment } = await import('@/modules/noc/services/projectTeamAssignmentService');
    const deleted = await deleteProjectTeamAssignment('pta-1');
    expect(deleted).toBe(true);
  });
});
