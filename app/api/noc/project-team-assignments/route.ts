import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { listProjectTeamAssignments, createProjectTeamAssignment } from '@/modules/noc/services/projectTeamAssignmentService';
import type { ProjectTeamAssignment } from '@/modules/noc/types/team';

const logger = createLogger('noc:api:project-team-assignments');

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const teamId = searchParams.get('team_id') ?? undefined;
    const projectId = searchParams.get('project_id') ?? undefined;
    const assignments = await listProjectTeamAssignments({ team_id: teamId, project_id: projectId });
    return NextResponse.json({ success: true, data: assignments });
  } catch (error) {
    logger.error('Failed to list project-team assignments', { error });
    return NextResponse.json(
      { success: false, error: { code: 'DATABASE_ERROR', message: 'Failed to fetch assignments' } },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { project_id: string; team_id: string; role: ProjectTeamAssignment['role'] };
    if (!body.project_id || !body.team_id) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'project_id and team_id are required' } },
        { status: 422 }
      );
    }
    const validRoles = ['activations', 'maintenance', 'civils', 'optical', 'fault_repair', 'other'] as const;
    const role = validRoles.includes(body.role as typeof validRoles[number]) ? body.role : 'activations';
    const assignment = await createProjectTeamAssignment({ project_id: body.project_id, team_id: body.team_id, role });
    return NextResponse.json({ success: true, data: assignment }, { status: 201 });
  } catch (error: unknown) {
    logger.error('Failed to create project-team assignment', { error });
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === '23505') {
      return NextResponse.json(
        { success: false, error: { code: 'DUPLICATE_ERROR', message: 'This team-project-role combination already exists' } },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { success: false, error: { code: 'DATABASE_ERROR', message: 'Failed to create assignment' } },
      { status: 500 }
    );
  }
}
