import { query, queryOne } from '../utils/db';
import { createLogger } from '@/lib/logger';
import type { ProjectTeamAssignment } from '../types/team';

const logger = createLogger('noc:projectTeamAssignmentService');

export async function listProjectTeamAssignments(filters?: { team_id?: string; project_id?: string }): Promise<ProjectTeamAssignment[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters?.team_id) {
    params.push(filters.team_id);
    where.push(`pta.team_id = $${params.length}`);
  }
  if (filters?.project_id) {
    params.push(filters.project_id);
    where.push(`pta.project_id = $${params.length}`);
  }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return query<ProjectTeamAssignment>(
    `SELECT pta.id, pta.project_id, pta.team_id, pta.role, pta.created_at::text as created_at,
       p.project_name as project_name, t.name as team_name
     FROM project_team_assignments pta
     JOIN projects p ON p.id = pta.project_id
     JOIN teams t ON t.id = pta.team_id
     ${whereClause}
     ORDER BY p.project_name, pta.role`,
    params
  );
}

export async function createProjectTeamAssignment(payload: {
  project_id: string; team_id: string; role: ProjectTeamAssignment['role'];
}): Promise<ProjectTeamAssignment> {
  logger.info('Creating project-team assignment', payload);
  const row = await queryOne<ProjectTeamAssignment>(
    `INSERT INTO project_team_assignments (project_id, team_id, role) VALUES ($1, $2, $3)
     RETURNING id, project_id, team_id, role, created_at::text as created_at`,
    [payload.project_id, payload.team_id, payload.role]
  );
  if (!row) throw new Error('Insert returned no row');
  return row;
}

export async function deleteProjectTeamAssignment(id: string): Promise<boolean> {
  logger.info('Deleting project-team assignment', { id });
  const rows = await query(`DELETE FROM project_team_assignments WHERE id = $1 RETURNING id`, [id]);
  return rows.length > 0;
}

export async function getActivationsTeamForProject(projectId: string): Promise<string | null> {
  const row = await queryOne<{ team_id: string }>(
    `SELECT team_id FROM project_team_assignments WHERE project_id = $1 AND role = 'activations' LIMIT 1`,
    [projectId]
  );
  return row?.team_id ?? null;
}
