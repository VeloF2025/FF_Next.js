/**
 * Project Team Service
 * Sprint 1: Project Hub Foundation
 *
 * TDD Phase: GREEN - Implementation complete
 */

import { neon } from '@/lib/db-neon';

const getSql = () => neon(process.env.DATABASE_URL!);

export interface TeamMember {
  person_id: string;
  person_type: 'staff' | 'contractor';
  name: string;
  email?: string;
  phone?: string;
  role: string;
  is_active: boolean;
  is_primary: boolean;
  start_date?: string;
}

export interface PrimaryManager {
  staff_id: string;
  name: string;
  role: string;
  is_primary: boolean;
}

export interface AssignResult {
  success: boolean;
  data?: { is_primary: boolean };
  error?: string;
}

export interface TeamOptions {
  includeInactive?: boolean;
}

export interface AssignOptions {
  requesterRole?: string;
}

/**
 * Get the primary manager for a project
 * @param projectId - Project UUID
 * @returns Primary manager or null
 */
export async function getPrimaryManager(projectId: string): Promise<PrimaryManager | null> {
  const sql = getSql();

  const result = await sql`
    SELECT
      sp.staff_id::text as staff_id,
      COALESCE(s.first_name || ' ' || s.last_name, 'Unknown') as name,
      sp.role,
      sp.is_primary
    FROM staff_projects sp
    JOIN staff s ON s.id = sp.staff_id
    WHERE sp.project_id = ${projectId}
    AND sp.is_primary = true
    AND sp.is_active = true
    LIMIT 1
  `;

  if (!result || result.length === 0) {
    return null;
  }

  return {
    staff_id: result[0]!.staff_id,
    name: result[0]!.name,
    role: result[0]!.role || 'Project Manager',
    is_primary: result[0]!.is_primary,
  };
}

/**
 * Get unified team (staff + contractors) for a project
 * @param projectId - Project UUID
 * @param options - Query options
 * @returns Array of team members
 */
export async function getUnifiedTeam(
  projectId: string,
  options: TeamOptions = {}
): Promise<TeamMember[]> {
  const sql = getSql();

  const result = options.includeInactive
    ? await sql`
        SELECT
          person_id,
          person_type,
          name,
          email,
          phone,
          role,
          is_active,
          is_primary,
          start_date
        FROM v_project_team
        WHERE project_id = ${projectId}
        ORDER BY is_primary DESC, person_type, name
      `
    : await sql`
        SELECT
          person_id,
          person_type,
          name,
          email,
          phone,
          role,
          is_active,
          is_primary,
          start_date
        FROM v_project_team
        WHERE project_id = ${projectId}
        AND is_active = true
        ORDER BY is_primary DESC, person_type, name
      `;

  return result.map(row => ({
    person_id: row.person_id,
    person_type: row.person_type as 'staff' | 'contractor',
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role || 'Team Member',
    is_active: row.is_active,
    is_primary: row.is_primary,
    start_date: row.start_date?.toISOString?.() || row.start_date,
  }));
}

/**
 * Assign a staff member as primary manager
 * @param projectId - Project UUID
 * @param staffId - Staff UUID
 * @param options - Assignment options
 * @returns Assignment result
 */
export async function assignPrimaryManager(
  projectId: string,
  staffId: string,
  options: AssignOptions = {}
): Promise<AssignResult> {
  // Check permissions
  if (options.requesterRole && options.requesterRole !== 'admin') {
    throw new Error('Insufficient permissions');
  }

  const sql = getSql();

  // Check if staff is assigned to project
  const existingAssignment = await sql`
    SELECT id FROM staff_projects
    WHERE project_id = ${projectId} AND staff_id = ${staffId}
  `;

  if (!existingAssignment || existingAssignment.length === 0) {
    return {
      success: false,
      error: 'Staff not assigned to project',
    };
  }

  // Unset any existing primary manager
  await sql`
    UPDATE staff_projects
    SET is_primary = false
    WHERE project_id = ${projectId} AND is_primary = true
  `;

  // Set new primary manager
  await sql`
    UPDATE staff_projects
    SET is_primary = true, role = 'Project Manager'
    WHERE project_id = ${projectId} AND staff_id = ${staffId}
  `;

  return {
    success: true,
    data: { is_primary: true },
  };
}
