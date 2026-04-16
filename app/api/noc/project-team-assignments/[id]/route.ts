import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { deleteProjectTeamAssignment } from '@/modules/noc/services/projectTeamAssignmentService';

const logger = createLogger('noc:api:project-team-assignments:id');

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const deleted = await deleteProjectTeamAssignment(params.id);
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Assignment not found' } },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete project-team assignment', { error, id: params.id });
    return NextResponse.json(
      { success: false, error: { code: 'DATABASE_ERROR', message: 'Failed to delete assignment' } },
      { status: 500 }
    );
  }
}
