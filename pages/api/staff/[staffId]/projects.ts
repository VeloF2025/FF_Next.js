/**
 * Staff Projects API
 * GET /api/staff/[staffId]/projects - Get all projects assigned to a staff member
 * POST /api/staff/[staffId]/projects - Assign staff to a project
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { createLogger } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('StaffProjectsAPI');

/**
 * Update the current_project_count for a staff member based on active assignments
 */
async function syncProjectCount(staffId: string): Promise<void> {
  await sql`
    UPDATE staff
    SET current_project_count = (
      SELECT COUNT(*) FROM staff_projects
      WHERE staff_id = ${staffId} AND is_active = true
    ),
    updated_at = NOW()
    WHERE id = ${staffId}
  `;
  logger.info('Synced project count for staff', { staffId });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthenticatedNextApiRequest;
  const { staffId, activeOnly } = req.query;

  if (!staffId || typeof staffId !== 'string') {
    return res.status(400).json({ error: 'Staff ID is required' });
  }

  // GET - Fetch projects for staff member
  if (req.method === 'GET') {
    try {
      let projects;

      if (activeOnly === 'true') {
        projects = await sql`
          SELECT
            sp.*,
            p.project_name as project_name,
            p.status as project_status,
            c.company_name as project_client,
            CONCAT(s.first_name, ' ', s.last_name) as staff_name,
            CONCAT(a.first_name, ' ', a.last_name) as assigned_by_name
          FROM staff_projects sp
          LEFT JOIN projects p ON p.id = sp.project_id
          LEFT JOIN clients c ON c.id = p.client_id
          LEFT JOIN staff s ON s.id = sp.staff_id
          LEFT JOIN staff a ON a.id = sp.assigned_by
          WHERE sp.staff_id = ${staffId}
            AND sp.is_active = true
          ORDER BY sp.created_at DESC
        `;
      } else {
        projects = await sql`
          SELECT
            sp.*,
            p.project_name as project_name,
            p.status as project_status,
            c.company_name as project_client,
            CONCAT(s.first_name, ' ', s.last_name) as staff_name,
            CONCAT(a.first_name, ' ', a.last_name) as assigned_by_name
          FROM staff_projects sp
          LEFT JOIN projects p ON p.id = sp.project_id
          LEFT JOIN clients c ON c.id = p.client_id
          LEFT JOIN staff s ON s.id = sp.staff_id
          LEFT JOIN staff a ON a.id = sp.assigned_by
          WHERE sp.staff_id = ${staffId}
          ORDER BY sp.created_at DESC
        `;
      }

      return res.status(200).json({
        success: true,
        projects: projects.map(mapDbToStaffProject),
        count: projects.length,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to fetch staff projects', { staffId, error: errorMessage });
      return res.status(500).json({ error: 'Failed to fetch projects', message: errorMessage });
    }
  }

  // POST - Assign staff to project
  if (req.method === 'POST') {
    try {
      const { projectId, role, startDate, endDate } = req.body;

      if (!projectId) {
        return res.status(400).json({ error: 'Project ID is required' });
      }

      // Get the current user for assigned_by
      let assignedBy: string | null = null;
      const userId = authReq.user?.id;
      if (userId) {
        const [staffMember] = await sql`
          SELECT id FROM staff WHERE user_id = ${userId}
        `;
        if (staffMember) {
          assignedBy = staffMember.id as string;
        }
      }

      // Check if assignment already exists
      const [existing] = await sql`
        SELECT id FROM staff_projects
        WHERE staff_id = ${staffId} AND project_id = ${projectId}
      `;

      if (existing) {
        // Reactivate if exists but inactive
        const [updated] = await sql`
          UPDATE staff_projects
          SET
            is_active = true,
            role = ${role || null},
            start_date = ${startDate ? new Date(startDate) : null},
            end_date = ${endDate ? new Date(endDate) : null},
            assigned_by = ${assignedBy},
            updated_at = NOW()
          WHERE staff_id = ${staffId} AND project_id = ${projectId}
          RETURNING *
        `;

        logger.info('Staff project assignment reactivated', { staffId, projectId });

        if (!updated) {
          return res.status(500).json({ error: 'Failed to update assignment' });
        }

        // Sync project count after reactivation
        await syncProjectCount(staffId);

        // Fetch with joins
        const [assignment] = await sql`
          SELECT
            sp.*,
            p.project_name as project_name,
            p.status as project_status,
            c.company_name as project_client,
            CONCAT(s.first_name, ' ', s.last_name) as staff_name,
            CONCAT(a.first_name, ' ', a.last_name) as assigned_by_name
          FROM staff_projects sp
          LEFT JOIN projects p ON p.id = sp.project_id
          LEFT JOIN clients c ON c.id = p.client_id
          LEFT JOIN staff s ON s.id = sp.staff_id
          LEFT JOIN staff a ON a.id = sp.assigned_by
          WHERE sp.id = ${updated.id}
        `;

        if (!assignment) {
          return res.status(500).json({ error: 'Failed to fetch updated assignment' });
        }

        return res.status(200).json({
          success: true,
          assignment: mapDbToStaffProject(assignment as Record<string, unknown>),
        });
      }

      // Create new assignment
      const [created] = await sql`
        INSERT INTO staff_projects (
          staff_id,
          project_id,
          role,
          start_date,
          end_date,
          is_active,
          assigned_by
        ) VALUES (
          ${staffId},
          ${projectId},
          ${role || null},
          ${startDate ? new Date(startDate) : null},
          ${endDate ? new Date(endDate) : null},
          ${true},
          ${assignedBy}
        )
        RETURNING *
      `;

      logger.info('Staff assigned to project', { staffId, projectId });

      if (!created) {
        return res.status(500).json({ error: 'Failed to create assignment' });
      }

      // Sync project count after new assignment
      await syncProjectCount(staffId);

      // Fetch with joins
      const [assignment] = await sql`
        SELECT
          sp.*,
          p.project_name as project_name,
          p.status as project_status,
          c.company_name as project_client,
          CONCAT(s.first_name, ' ', s.last_name) as staff_name,
          CONCAT(a.first_name, ' ', a.last_name) as assigned_by_name
        FROM staff_projects sp
        LEFT JOIN projects p ON p.id = sp.project_id
        LEFT JOIN clients c ON c.id = p.client_id
        LEFT JOIN staff s ON s.id = sp.staff_id
        LEFT JOIN staff a ON a.id = sp.assigned_by
        WHERE sp.id = ${created.id}
      `;

      if (!assignment) {
        return res.status(500).json({ error: 'Failed to fetch created assignment' });
      }

      return res.status(201).json({
        success: true,
        assignment: mapDbToStaffProject(assignment as Record<string, unknown>),
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to assign staff to project', { staffId, error: errorMessage });
      return res.status(500).json({ error: 'Failed to assign staff to project', message: errorMessage });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(withArcjetProtection(handler, aj));

// Map database row to StaffProject interface
function mapDbToStaffProject(row: Record<string, unknown>) {
  return {
    id: row.id,
    staffId: row.staff_id,
    projectId: row.project_id,
    role: row.role,
    startDate: row.start_date ? new Date(row.start_date as string).toISOString() : undefined,
    endDate: row.end_date ? new Date(row.end_date as string).toISOString() : undefined,
    isActive: row.is_active,
    assignedBy: row.assigned_by,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    project: row.project_name
      ? {
          id: row.project_id,
          name: row.project_name,
          status: row.project_status,
          client: row.project_client,
        }
      : undefined,
    staff: row.staff_name
      ? {
          id: row.staff_id,
          name: row.staff_name,
        }
      : undefined,
    assignedByStaff: row.assigned_by_name
      ? {
          id: row.assigned_by,
          name: row.assigned_by_name,
        }
      : undefined,
  };
}
