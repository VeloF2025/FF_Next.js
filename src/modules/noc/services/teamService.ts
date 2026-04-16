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
  ProjectTeamAssignment,
} from '../types/team';

const logger = createLogger('maintenance:teamService');

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
    const values: unknown[] = [];
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

    // Auto-add lead as team member so they appear in useMyTeams()
    if (payload.lead_user_id) {
      await ensureLeadIsTeamMember(team.id, payload.lead_user_id);
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
    const values: unknown[] = [];
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

    // Auto-add new lead as team member so they appear in useMyTeams()
    if (payload.lead_user_id) {
      await ensureLeadIsTeamMember(id, payload.lead_user_id);
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

/**
 * Ensure the team lead exists in team_members table.
 * Without this, useMyTeams() won't find the team for the lead user.
 */
async function ensureLeadIsTeamMember(teamId: string, leadUserId: string): Promise<void> {
  try {
    // Check if lead is already a member
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM team_members WHERE team_id = $1 AND user_id = $2 AND is_active = true`,
      [teamId, leadUserId]
    );

    if (existing) return;

    // Get user details for the member record
    const user = await queryOne<{ first_name: string; last_name: string; email: string }>(
      `SELECT first_name, last_name, email FROM users WHERE id = $1`,
      [leadUserId]
    );

    if (!user) {
      logger.warn('Lead user not found in users table', { leadUserId });
      return;
    }

    await query(
      `INSERT INTO team_members (team_id, user_id, first_name, last_name, email, is_team_lead, is_active)
       VALUES ($1, $2, $3, $4, $5, true, true)
       ON CONFLICT DO NOTHING`,
      [teamId, leadUserId, user.first_name, user.last_name || '', user.email]
    );

    logger.info('Auto-added lead as team member', { teamId, leadUserId });
  } catch (error) {
    logger.error('Failed to auto-add lead as team member', { error, teamId, leadUserId });
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
    const result = await query<{
      id: string;
      name: string;
      team_type: string;
      member_count: number;
      lead_name: string | null;
      contractor_name: string | null;
      assignment_id: string | null;
      project_id: string | null;
      project_name: string | null;
      role: string | null;
      assignment_created_at: string | null;
    }>(
      `SELECT
         t.id, t.name, t.team_type,
         (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id AND tm.is_active = true)::int as member_count,
         COALESCE(u.first_name || ' ' || u.last_name, u.email) as lead_name,
         c.name as contractor_name,
         pta.id as assignment_id,
         pta.project_id,
         p.project_name,
         pta.role,
         pta.created_at::text as assignment_created_at
       FROM teams t
       LEFT JOIN users u ON u.id = t.lead_user_id
       LEFT JOIN contractors c ON c.id = t.contractor_id
       LEFT JOIN project_team_assignments pta ON pta.team_id = t.id
       LEFT JOIN projects p ON p.id = pta.project_id
       WHERE t.is_active = true
       ORDER BY
         CASE WHEN t.contractor_id IS NULL THEN 0 ELSE 1 END,
         t.name ASC`
    );

    // Collapse multiple assignment rows into one TeamDropdownOption per team
    const teamMap = new Map<string, TeamDropdownOption>();
    for (const row of result) {
      if (!teamMap.has(row.id)) {
        teamMap.set(row.id, {
          id: row.id,
          name: row.name,
          type: row.team_type === 'contractor' ? 'contractor' : 'internal',
          team_type: row.team_type,
          member_count: row.member_count,
          lead_name: row.lead_name || undefined,
          contractor_name: row.contractor_name || undefined,
          project_assignments: [],
        });
      }
      if (row.assignment_id) {
        teamMap.get(row.id)!.project_assignments!.push({
          id: row.assignment_id,
          project_id: row.project_id!,
          team_id: row.id,
          role: row.role as ProjectTeamAssignment['role'],
          created_at: row.assignment_created_at!,
          project_name: row.project_name || undefined,
        });
      }
    }
    return Array.from(teamMap.values());
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

/**
 * Check if a user is the lead of a specific team
 * Checks both the team's lead_user_id and the team_members is_team_lead flag
 */
export async function isTeamLead(userId: string, teamId: string): Promise<boolean> {
  if (!isValidUUID(userId) || !isValidUUID(teamId)) return false;

  const sql = `
    SELECT EXISTS(
      SELECT 1 FROM maintenance_teams
      WHERE id = $1 AND lead_user_id = $2 AND is_active = true
      UNION
      SELECT 1 FROM maintenance_team_members
      WHERE team_id = $1 AND user_id = $2 AND is_team_lead = true AND is_active = true
    ) AS is_lead
  `;

  const result = await queryOne<{ is_lead: boolean }>(sql, [teamId, userId]);
  return result?.is_lead ?? false;
}
