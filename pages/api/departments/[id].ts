/**
 * Department API - Single Department Operations
 * GET /api/departments/[id] - Get department with staff list
 * PUT /api/departments/[id] - Update department
 * DELETE /api/departments/[id] - Soft delete department
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { createLogger } from '@/lib/logger';
import type { DepartmentDetail, DepartmentStaffMember, UpdateDepartmentRequest } from '@/types/staff/department.types';

const log = createLogger('DepartmentDetailAPI');

interface DepartmentRow {
  id: string;
  name: string;
  code: string;
  description: string | null;
  managerId: string | null;
  managerName: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sql = neon(process.env.DATABASE_URL!);
  const { id } = req.query;

  if (typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Invalid department ID');
  }

  if (req.method === 'GET') {
    log.info('Fetching department detail', { id });

    // Get department
    const departments = await sql`
      SELECT
        d.id,
        d.name,
        d.code,
        d.description,
        d.manager_id as "managerId",
        COALESCE(m.first_name || ' ' || m.last_name, m.name) as "managerName",
        d.is_active as "isActive",
        d.created_at as "createdAt",
        d.updated_at as "updatedAt"
      FROM departments d
      LEFT JOIN staff m ON d.manager_id = m.id
      WHERE d.id = ${id}
    ` as DepartmentRow[];

    if (departments.length === 0) {
      return apiResponse.notFound(res, 'Department', id);
    }

    const department = departments[0];

    // Get staff in this department
    const staff = await sql`
      SELECT
        s.id,
        s.employee_id as "employeeId",
        COALESCE(s.first_name || ' ' || s.last_name, s.name) as name,
        s.position,
        s.status,
        s.email,
        s.phone,
        s.join_date as "joinDate",
        (
          SELECT COUNT(*) FROM staff_projects sp WHERE sp.staff_id = s.id
        ) as "projectCount"
      FROM staff s
      WHERE s.department_id = ${id}
      ORDER BY s.status = 'active' DESC, s.name ASC
    ` as DepartmentStaffMember[];

    // Calculate counts
    const staffCount = staff.filter((s) => !['terminated', 'resigned', 'retired'].includes(s.status)).length;
    const activeCount = staff.filter((s) => s.status === 'active').length;
    const onLeaveCount = staff.filter((s) => s.status === 'on_leave').length;

    return apiResponse.success(res, {
      ...department,
      staffCount,
      activeCount,
      onLeaveCount,
      staff,
    } as DepartmentDetail);
  }

  if (req.method === 'PUT') {
    const body = req.body as UpdateDepartmentRequest;

    log.info('Updating department', { id, updates: Object.keys(body) });

    // Check department exists
    const existing = await sql`SELECT id FROM departments WHERE id = ${id}` as { id: string }[];
    if (existing.length === 0) {
      return apiResponse.notFound(res, 'Department', id);
    }

    // Build update values
    const nameVal = body.name !== undefined ? body.name.trim() : null;
    const codeVal = body.code !== undefined
      ? body.code.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
      : null;
    const descVal = body.description !== undefined ? (body.description || null) : undefined;
    const managerVal = body.managerId !== undefined ? (body.managerId || null) : undefined;
    const activeVal = body.isActive !== undefined ? body.isActive : null;

    // Check for name/code conflicts
    if (nameVal || codeVal) {
      const conflict = await sql`
        SELECT id FROM departments
        WHERE id != ${id}
          AND is_active = true
          AND (
            (${nameVal !== null} AND LOWER(name) = LOWER(${nameVal}))
            OR (${codeVal !== null} AND code = ${codeVal})
          )
      ` as { id: string }[];
      if (conflict.length > 0) {
        return apiResponse.badRequest(res, 'Department with this name or code already exists');
      }
    }

    // Execute update
    const result = await sql`
      UPDATE departments
      SET
        name = COALESCE(${nameVal}, name),
        code = COALESCE(${codeVal}, code),
        description = CASE WHEN ${descVal !== undefined} THEN ${descVal as string | null} ELSE description END,
        manager_id = CASE WHEN ${managerVal !== undefined} THEN ${managerVal as string | null} ELSE manager_id END,
        is_active = COALESCE(${activeVal}, is_active),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING
        id,
        name,
        code,
        description,
        manager_id as "managerId",
        is_active as "isActive",
        created_at as "createdAt",
        updated_at as "updatedAt"
    ` as DepartmentRow[];

    log.info('Department updated', { id });

    return apiResponse.success(res, result[0]);
  }

  if (req.method === 'DELETE') {
    log.info('Soft deleting department', { id });

    // Check department exists
    const existing = await sql`SELECT id, name FROM departments WHERE id = ${id}` as { id: string; name: string }[];
    if (existing.length === 0) {
      return apiResponse.notFound(res, 'Department', id);
    }

    // Check if department has active staff
    const staffCount = await sql`
      SELECT COUNT(*) as count FROM staff
      WHERE department_id = ${id}
        AND status NOT IN ('terminated', 'resigned', 'retired')
    ` as { count: string }[];

    if (staffCount[0] && Number(staffCount[0].count) > 0) {
      return apiResponse.badRequest(res, `Cannot delete department with ${staffCount[0].count} active staff members`);
    }

    // Soft delete
    await sql`
      UPDATE departments
      SET is_active = false, updated_at = NOW()
      WHERE id = ${id}
    `;

    log.info('Department soft deleted', { id, name: existing[0]?.name });

    return apiResponse.success(res, { message: 'Department deleted successfully' });
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PUT', 'DELETE']);
}

export default withAuth(handler);
