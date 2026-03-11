/**
 * Team Members API Route
 *
 * GET    /api/noc/teams/[id]/members - List members
 * POST   /api/noc/teams/[id]/members - Add member
 * DELETE /api/noc/teams/[id]/members?memberId=xxx - Remove member
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  getTeamMembers,
  addTeamMember,
  removeTeamMember,
} from '@/modules/noc/services/teamService';
import type { AddTeamMemberPayload } from '@/modules/noc/types/team';

const logger = createLogger('maintenance:api:teams:members');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

export async function GET(
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

    const members = await getTeamMembers(teamId);

    return NextResponse.json({
      success: true,
      data: members,
      meta: { timestamp: new Date().toISOString(), count: members.length },
    });
  } catch (error) {
    logger.error('Error fetching team members', { error, teamId: params.id });
    return NextResponse.json(
      {
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to fetch team members' },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 500 }
    );
  }
}

export async function POST(
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

    const body = await req.json();

    if (!body.first_name?.trim() || !body.last_name?.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'First name and last name are required' },
          meta: { timestamp: new Date().toISOString() },
        },
        { status: 422 }
      );
    }

    const payload: AddTeamMemberPayload = {
      team_id: teamId,
      user_id: body.user_id || undefined,
      contractor_id: body.contractor_id || undefined,
      first_name: body.first_name.trim(),
      last_name: body.last_name.trim(),
      email: body.email || undefined,
      phone: body.phone || undefined,
      role: body.role || undefined,
      skill_level: body.skill_level || undefined,
      is_team_lead: body.is_team_lead || false,
    };

    logger.info('Adding member to team', { teamId, name: `${payload.first_name} ${payload.last_name}` });

    const member = await addTeamMember(payload);

    return NextResponse.json(
      {
        success: true,
        data: member,
        message: 'Member added successfully',
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error('Error adding team member', { error, teamId: params.id });
    return NextResponse.json(
      {
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to add team member' },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(req.url);
    const memberId = searchParams.get('memberId');

    if (!memberId || !isValidUUID(memberId)) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Valid member ID is required as query param' },
          meta: { timestamp: new Date().toISOString() },
        },
        { status: 422 }
      );
    }

    logger.info('Removing team member', { teamId: params.id, memberId });

    await removeTeamMember(memberId);

    return NextResponse.json({
      success: true,
      message: 'Member removed successfully',
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    logger.error('Error removing team member', { error, teamId: params.id });
    return NextResponse.json(
      {
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to remove team member' },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 500 }
    );
  }
}
