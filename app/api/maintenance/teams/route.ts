/**
 * Teams API Route - List and Create
 *
 * GET  /api/ticketing/teams - List all teams
 * POST /api/ticketing/teams - Create new team
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  listTeams,
  createTeam,
  getTeamsForDropdown,
} from '@/modules/ticketing/services/teamService';
import type { CreateTeamPayload, TeamFilters } from '@/modules/ticketing/types/team';

const logger = createLogger('ticketing:api:teams');

/**
 * GET /api/ticketing/teams
 *
 * Query params:
 * - team_type: Filter by team type
 * - contractor_id: Filter by contractor
 * - is_active: Filter by active status
 * - search: Search by name/description
 * - dropdown: If 'true', returns simplified format for dropdowns
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const isDropdown = searchParams.get('dropdown') === 'true';

    if (isDropdown) {
      const teams = await getTeamsForDropdown();
      return NextResponse.json({
        success: true,
        data: teams,
        meta: { timestamp: new Date().toISOString() },
      });
    }

    const filters: TeamFilters = {};

    if (searchParams.has('team_type')) {
      filters.team_type = searchParams.get('team_type')!;
    }
    if (searchParams.has('contractor_id')) {
      filters.contractor_id = searchParams.get('contractor_id')!;
    }
    if (searchParams.has('is_active')) {
      filters.is_active = searchParams.get('is_active') === 'true';
    }
    if (searchParams.has('search')) {
      filters.search = searchParams.get('search')!;
    }

    logger.debug('Fetching teams', { filters });

    const teams = await listTeams(filters);

    return NextResponse.json({
      success: true,
      data: teams,
      meta: { timestamp: new Date().toISOString(), count: teams.length },
    });
  } catch (error) {
    logger.error('Error fetching teams', { error });
    return NextResponse.json(
      {
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to fetch teams' },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/ticketing/teams
 */
export async function POST(req: NextRequest) {
  try {
    const body: CreateTeamPayload = await req.json();

    // Validate required fields
    if (!body.name?.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Team name is required' },
          meta: { timestamp: new Date().toISOString() },
        },
        { status: 422 }
      );
    }

    logger.info('Creating team', { name: body.name, type: body.team_type });

    const team = await createTeam(body);

    return NextResponse.json(
      {
        success: true,
        data: team,
        message: 'Team created successfully',
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 201 }
    );
  } catch (error: any) {
    logger.error('Error creating team', { error });

    // Check for unique constraint violation
    if (error.message?.includes('unique') || error.code === '23505') {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'DUPLICATE_ERROR', message: 'A team with this name already exists' },
          meta: { timestamp: new Date().toISOString() },
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to create team' },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 500 }
    );
  }
}
