/**
 * Individual Team API Route
 *
 * GET    /api/ticketing/teams/[id] - Get team by ID
 * PUT    /api/ticketing/teams/[id] - Update team
 * DELETE /api/ticketing/teams/[id] - Delete team (soft delete)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  getTeamById,
  updateTeam,
  deleteTeam,
  getTeamMembers,
} from '@/modules/ticketing/services/teamService';
import type { UpdateTeamPayload } from '@/modules/ticketing/types/team';

const logger = createLogger('ticketing:api:teams:id');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * GET /api/ticketing/teams/[id]
 *
 * Query params:
 * - include_members: If 'true', includes team members
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const teamId = params.id;
    const { searchParams } = new URL(req.url);
    const includeMembers = searchParams.get('include_members') === 'true';

    if (!isValidUUID(teamId)) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid team ID format' },
          meta: { timestamp: new Date().toISOString() },
        },
        { status: 422 }
      );
    }

    logger.debug('Fetching team', { teamId, includeMembers });

    const team = await getTeamById(teamId);

    if (!team) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'NOT_FOUND', message: `Team with ID '${teamId}' not found` },
          meta: { timestamp: new Date().toISOString() },
        },
        { status: 404 }
      );
    }

    let members = null;
    if (includeMembers) {
      members = await getTeamMembers(teamId);
    }

    return NextResponse.json({
      success: true,
      data: {
        ...team,
        ...(members && { members }),
      },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    logger.error('Error fetching team', { error, teamId: params.id });
    return NextResponse.json(
      {
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to fetch team' },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/ticketing/teams/[id]
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const teamId = params.id;

    if (!isValidUUID(teamId)) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid team ID format' },
          meta: { timestamp: new Date().toISOString() },
        },
        { status: 422 }
      );
    }

    const body: UpdateTeamPayload = await req.json();

    if (Object.keys(body).length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Update payload cannot be empty' },
          meta: { timestamp: new Date().toISOString() },
        },
        { status: 422 }
      );
    }

    logger.info('Updating team', { teamId, fields: Object.keys(body) });

    const team = await updateTeam(teamId, body);

    return NextResponse.json({
      success: true,
      data: team,
      message: 'Team updated successfully',
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error: any) {
    logger.error('Error updating team', { error, teamId: params.id });

    if (error.message?.includes('not found')) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'NOT_FOUND', message: error.message },
          meta: { timestamp: new Date().toISOString() },
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to update team' },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/ticketing/teams/[id]
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const teamId = params.id;

    if (!isValidUUID(teamId)) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid team ID format' },
          meta: { timestamp: new Date().toISOString() },
        },
        { status: 422 }
      );
    }

    logger.info('Deleting team', { teamId });

    const team = await deleteTeam(teamId);

    return NextResponse.json({
      success: true,
      data: team,
      message: 'Team deleted successfully',
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error: any) {
    logger.error('Error deleting team', { error, teamId: params.id });

    if (error.message?.includes('not found')) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'NOT_FOUND', message: error.message },
          meta: { timestamp: new Date().toISOString() },
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to delete team' },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 500 }
    );
  }
}
