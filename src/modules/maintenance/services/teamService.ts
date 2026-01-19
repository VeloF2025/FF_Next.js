/**
 * Team Service - CRUD Operations for Teams
 *
 * Supports both internal (Velocity Fibre) teams and contractor teams.
 * Used for ticket assignment and workflow management.
 */

import { query, queryOne } from '../utils/db';
import { createLogger } from '@/lib/logger';
import type {
  Team,
  TeamMember,
  TeamDropdownOption,
  UserDropdownOption,
  CreateTeamPayload,
  UpdateTeamPayload,
  TeamFilters,
  AddTeamMemberPayload,
} from '../types/team';

const logger = createLogger('ticketing:teamService');

/**
 * UUID validation regex
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

// ==================== Team CRUD ====================

/**
 * List all teams with optional filters
 */
export async function listTeams(filters: TeamFilters = {}): Promise<Team[]> {
  logger.debug('Listing teams', { filters });

  try {
    const whereClauses: string[] = [];
    const values: any[] = [];
    let paramCounter = 1;

    if (filters.team_type) {
      whereClauses.push(`t.team_type = $${paramCounter}`);
      values.push(filters.team_type);
      paramCounter++;
    }

    if (filters.contractor_id) {
      whereClauses.push(`t.contractor_id = $${paramCounter}`);
      values.push(filters.contractor_id);
      paramCounter++;
    }

    if (filters.is_active !== undefined) {
      whereClauses.push(`t.is_active = $${paramCounter}`);
      values.push(filters.is_active);
      paramCounter++;
    }

    if (filters.search) {
      whereClauses.push(`(t.name ILIKE $${paramCounter} OR t.description ILIKE $${paramCounter})`);
      values.push(`%${filters.search}%`);
      paramCounter++;
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const sql = `
      SELECT
        t.*,
        CASE
          WHEN u.id IS NOT NULL THEN jsonb_build_object(
            'id', u.id,
            'name', COALESCE(u.first_name || ' ' || u.last_name, u.email),
            'email', u.email
          )
          ELSE NULL
        END as lead_user,
        (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id AND tm.is_active = true) as member_count
      FROM teams t
      LEFT JOIN users u ON t.lead_user_id = u.id
      ${whereClause}
      ORDER BY t.name ASC
    `;

    const teams = await query<Team>(sql, values);
    return teams;
  } catch (error) {
    logger.error('Failed to list teams', { error, filters });
    throw error;
  }
}

/**
 * Get team by ID with member count
 */
export async function getTeamById(id: string): Promise<Team | null> {
  if (!isValidUUID(id)) {
    throw new Error('Invalid team ID format');
  }

  logger.debug('Fetching team by ID', { id });

  try {
    const sql = `
      SELECT
        t.*,
        CASE
          WHEN u.id IS NOT NULL THEN jsonb_build_object(
            'id', u.id,
            'name', COALESCE(u.first_name || ' ' || u.last_name, u.email),
            'email', u.email
          )
          ELSE NULL
        END as lead_user,
        (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id AND tm.is_active = true) as member_count
      FROM teams t
      LEFT JOIN users u ON t.lead_user_id = u.id
      WHERE t.id = $1
    `;

    const team = await queryOne<Team>(sql, [id]);
    return team;
  } catch (error) {
    logger.error('Failed to fetch team', { error, id });
    throw error;
  }
}

/**
 * Create a new team
 */
export async function createTeam(payload: CreateTeamPayload): Promise<Team> {
  if (!payload.name?.trim()) {
    throw new Error('Team name is required');
  }

  logger.info('Creating team', { name: payload.name, type: payload.team_type });

  try {
    const sql = `
      INSERT INTO teams (name, description, team_type, lead_user_id, contractor_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

    const values = [
      payload.name.trim(),
      payload.description || null,
      payload.team_type || 'internal',
      payload.lead_user_id || null,
      payload.contractor_id || null,
    ];

    const team = await queryOne<Team>(sql, values);

    if (!team) {
      throw new Error('Failed to create team');
    }

    logger.info('Team created successfully', { id: team.id, name: team.name });
    return team;
  } catch (error) {
    logger.error('Failed to create team', { error, payload });
    throw error;
  }
}

/**
 * Update team
 */
export async function updateTeam(id: string, payload: UpdateTeamPayload): Promise<Team> {
  if (!isValidUUID(id)) {
    throw new Error('Invalid team ID format');
  }

  if (!payload || Object.keys(payload).length === 0) {
    throw new Error('Update payload cannot be empty');
  }

  logger.info('Updating team', { id, fields: Object.keys(payload) });

  try {
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramCounter = 1;

    const fieldMap: Record<string, string> = {
      name: 'name',
      description: 'description',
      team_type: 'team_type',
      lead_user_id: 'lead_user_id',
      contractor_id: 'contractor_id',
      is_active: 'is_active',
    };

    for (const [key, value] of Object.entries(payload)) {
      if (key in fieldMap) {
        updateFields.push(`${fieldMap[key]} = $${paramCounter}`);
        values.push(value);
        paramCounter++;
      }
    }

    updateFields.push('updated_at = NOW()');
    values.push(id);

    const sql = `
      UPDATE teams
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCounter}
      RETURNING *
    `;

    const team = await queryOne<Team>(sql, values);

    if (!team) {
      throw new Error(`Team with ID ${id} not found`);
    }

    logger.info('Team updated successfully', { id, name: team.name });
    return team;
  } catch (error) {
    logger.error('Failed to update team', { error, id, payload });
    throw error;
  }
}

/**
 * Delete team (soft delete - set is_active = false)
 */
export async function deleteTeam(id: string): Promise<Team> {
  if (!isValidUUID(id)) {
    throw new Error('Invalid team ID format');
  }

  logger.info('Soft deleting team', { id });

  try {
    const sql = `
      UPDATE teams
      SET is_active = false, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const team = await queryOne<Team>(sql, [id]);

    if (!team) {
      throw new Error(`Team with ID ${id} not found`);
    }

    logger.info('Team soft deleted', { id, name: team.name });
    return team;
  } catch (error) {
    logger.error('Failed to delete team', { error, id });
    throw error;
  }
}

// ==================== Team Members ====================

/**
 * Get members of a team
 */
export async function getTeamMembers(teamId: string): Promise<TeamMember[]> {
  if (!isValidUUID(teamId)) {
    throw new Error('Invalid team ID format');
  }

  logger.debug('Fetching team members', { teamId });

  try {
    const sql = `
      SELECT * FROM team_members
      WHERE team_id = $1 AND is_active = true
      ORDER BY is_team_lead DESC, first_name ASC
    `;

    const members = await query<TeamMember>(sql, [teamId]);
    return members;
  } catch (error) {
    logger.error('Failed to fetch team members', { error, teamId });
    throw error;
  }
}

/**
 * Add member to team
 */
export async function addTeamMember(payload: AddTeamMemberPayload): Promise<TeamMember> {
  if (!isValidUUID(payload.team_id)) {
    throw new Error('Invalid team ID format');
  }

  logger.info('Adding team member', { teamId: payload.team_id, name: `${payload.first_name} ${payload.last_name}` });

  try {
    const sql = `
      INSERT INTO team_members (
        team_id, user_id, contractor_id, first_name, last_name,
        email, phone, role, skill_level, is_team_lead
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const values = [
      payload.team_id,
      payload.user_id || null,
      payload.contractor_id || null,
      payload.first_name,
      payload.last_name,
      payload.email || null,
      payload.phone || null,
      payload.role || null,
      payload.skill_level || null,
      payload.is_team_lead || false,
    ];

    const member = await queryOne<TeamMember>(sql, values);

    if (!member) {
      throw new Error('Failed to add team member');
    }

    logger.info('Team member added', { id: member.id, teamId: payload.team_id });
    return member;
  } catch (error) {
    logger.error('Failed to add team member', { error, payload });
    throw error;
  }
}

/**
 * Remove member from team (soft delete)
 */
export async function removeTeamMember(memberId: string): Promise<void> {
  if (!isValidUUID(memberId)) {
    throw new Error('Invalid member ID format');
  }

  logger.info('Removing team member', { memberId });

  try {
    const sql = `
      UPDATE team_members
      SET is_active = false, updated_at = NOW()
      WHERE id = $1
    `;

    await query(sql, [memberId]);
    logger.info('Team member removed', { memberId });
  } catch (error) {
    logger.error('Failed to remove team member', { error, memberId });
    throw error;
  }
}

// ==================== Dropdown Options ====================

/**
 * Get all teams formatted for dropdown selection
 * Includes both internal teams and contractor teams
 */
export async function getTeamsForDropdown(): Promise<TeamDropdownOption[]> {
  logger.debug('Fetching teams for dropdown');

  try {
    const sql = `
      SELECT
        t.id,
        t.name,
        CASE WHEN t.contractor_id IS NOT NULL THEN 'contractor' ELSE 'internal' END as type,
        t.team_type,
        (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id AND tm.is_active = true) as member_count,
        COALESCE(u.first_name || ' ' || u.last_name, u.email) as lead_name
      FROM teams t
      LEFT JOIN users u ON t.lead_user_id = u.id
      WHERE t.is_active = true
      ORDER BY
        CASE WHEN t.contractor_id IS NULL THEN 0 ELSE 1 END,
        t.name ASC
    `;

    const teams = await query<TeamDropdownOption>(sql, []);
    return teams;
  } catch (error) {
    logger.error('Failed to fetch teams for dropdown', { error });
    throw error;
  }
}

/**
 * Get all active staff members formatted for dropdown selection
 * Note: tickets.assigned_to references staff.id (not users.id)
 */
export async function getUsersForDropdown(): Promise<UserDropdownOption[]> {
  logger.debug('Fetching staff for assignment dropdown');

  try {
    // Query from staff table (tickets.assigned_to FK references staff.id)
    const sql = `
      SELECT
        id,
        COALESCE(first_name || ' ' || last_name, email) as name,
        email,
        position as role,
        department
      FROM staff
      WHERE status = 'active'
      ORDER BY first_name ASC, last_name ASC
    `;

    const users = await query<UserDropdownOption>(sql, []);
    return users;
  } catch (error) {
    logger.error('Failed to fetch users for dropdown', { error });
    throw error;
  }
}
