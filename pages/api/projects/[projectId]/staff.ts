/**
 * Project Staff API
 * GET /api/projects/[projectId]/staff - Get all staff assigned to a project
 * POST /api/projects/[projectId]/staff - Assign staff to project
 * DELETE /api/projects/[projectId]/staff/[staffId] - Remove staff from project
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { createLogger } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('ProjectStaffAPI');

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
  const { projectId, activeOnly, staffId: staffIdToRemove } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return res.status(400).json({ error: 'Project ID is required' });
  }

  // GET - Fetch staff for project
  if (req.method === 'GET') {
    try {
      let staff;

      if (activeOnly === 'true') {
        staff = await sql`
          SELECT
            sp.*,
            p.name as project_name,
            p.status as project_status,
            s.name as staff_name,
            s.email as staff_email,
            s.position as staff_position,
            a.name as assigned_by_name
          FROM staff_projects sp
          LEFT JOIN projects p ON p.id = sp.project_id
          LEFT JOIN staff s ON s.id = sp.staff_id
          LEFT JOIN staff a ON a.id = sp.assigned_by
          WHERE sp.project_id = ${projectId}
            AND sp.is_active = true
          ORDER BY s.name ASC
        `;
      } else {
        staff = await sql`
          SELECT
            sp.*,
            p.name as project_name,
            p.status as project_status,
            s.name as staff_name,
            s.email as staff_email,
            s.position as staff_position,
            a.name as assigned_by_name
          FROM staff_projects sp
          LEFT JOIN projects p ON p.id = sp.project_id
          LEFT JOIN staff s ON s.id = sp.staff_id
          LEFT JOIN staff a ON a.id = sp.assigned_by
          WHERE sp.project_id = ${projectId}
          ORDER BY s.name ASC
        `;
      }

      // Group by role
      const byRole: Record<string, unknown[]> = {};
      staff.forEach((s: Record<string, unknown>) => {
        const role = (s.role as string) || 'Unassigned';
        if (!byRole[role]) byRole[role] = [];
        byRole[role].push(mapDbToStaffProject(s));
      });

      return res.status(200).json({
        success: true,
        staff: staff.map(mapDbToStaffProject),
        byRole,
        count: staff.length,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to fetch project staff', { projectId, error: errorMessage });
      return res.status(500).json({ error: 'Failed to fetch staff', message: errorMessage });
    }
  }

  // POST - Assign staff to project
  if (req.method === 'POST') {
    try {
      const { staffId, role, startDate, endDate } = req.body;

      if (!staffId) {
        return res.status(400).json({ error: 'Staff ID is required' });
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

        logger.info('Staff assignment reactivated', { staffId, projectId });

        if (!updated) {
          return res.status(500).json({ error: 'Failed to update assignment' });
        }

        // Sync project count after reactivation
        await syncProjectCount(staffId);

        return res.status(200).json({
          success: true,
          assignment: mapDbToStaffProject(updated as Record<string, unknown>),
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

      return res.status(201).json({
        success: true,
        assignment: mapDbToStaffProject(created as Record<string, unknown>),
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to assign staff to project', { projectId, error: errorMessage });
      return res.status(500).json({ error: 'Failed to assign staff', message: errorMessage });
    }
  }

  // DELETE - Remove staff from project (soft delete - set inactive)
  if (req.method === 'DELETE') {
    try {
      if (!staffIdToRemove || typeof staffIdToRemove !== 'string') {
        return res.status(400).json({ error: 'Staff ID is required in query params' });
      }

      const [updated] = await sql`
        UPDATE staff_projects
        SET
          is_active = false,
          updated_at = NOW()
        WHERE staff_id = ${staffIdToRemove}
          AND project_id = ${projectId}
        RETURNING *
      `;

      if (!updated) {
        return res.status(404).json({ error: 'Assignment not found' });
      }

      // Sync project count after removal
      await syncProjectCount(staffIdToRemove);

      logger.info('Staff removed from project', { staffId: staffIdToRemove, projectId });

      return res.status(200).json({
        success: true,
        message: 'Staff removed from project',
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to remove staff from project', { projectId, error: errorMessage });
      return res.status(500).json({ error: 'Failed to remove staff', message: errorMessage });
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
    createdAt: row.created_at ? new Date(row.created_at as string).toISOString() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at as string).toISOString() : undefined,
    project: row.project_name
      ? {
          id: row.project_id,
          name: row.project_name,
          status: row.project_status,
        }
      : undefined,
    staff: row.staff_name
      ? {
          id: row.staff_id,
          name: row.staff_name,
          email: row.staff_email,
          position: row.staff_position,
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
