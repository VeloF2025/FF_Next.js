/**
 * Departments API - List and Create
 * GET /api/departments - List all departments with stats
 * POST /api/departments - Create new department
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { createLogger } from '@/lib/logger';
import type { Department, CreateDepartmentRequest } from '@/types/staff/department.types';

const log = createLogger('DepartmentsAPI');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sql = neon(process.env.DATABASE_URL!);

  if (req.method === 'GET') {
    const { search, isActive } = req.query;

    log.info('Fetching departments', { search, isActive });

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
        d.updated_at as "updatedAt",
        COUNT(s.id) FILTER (WHERE s.status NOT IN ('terminated', 'resigned', 'retired')) as "staffCount",
        COUNT(s.id) FILTER (WHERE s.status = 'active') as "activeCount",
        COUNT(s.id) FILTER (WHERE s.status = 'on_leave') as "onLeaveCount"
      FROM departments d
      LEFT JOIN staff m ON d.manager_id = m.id
      LEFT JOIN staff s ON s.department_id = d.id
      WHERE
        (${isActive === undefined} OR d.is_active = ${isActive === 'true'})
        AND (
          ${!search}
          OR d.name ILIKE ${'%' + (search || '') + '%'}
          OR d.code ILIKE ${'%' + (search || '') + '%'}
        )
      GROUP BY d.id, d.name, d.code, d.description, d.manager_id, m.first_name, m.last_name, m.name, d.is_active, d.created_at, d.updated_at
      ORDER BY d.name ASC
    ` as Department[];

    return apiResponse.success(res, departments);
  }

  if (req.method === 'POST') {
    const body = req.body as CreateDepartmentRequest;

    // Validation
    if (!body.name?.trim()) {
      return apiResponse.badRequest(res, 'Department name is required');
    }
    if (!body.code?.trim()) {
      return apiResponse.badRequest(res, 'Department code is required');
    }

    // Normalize code
    const code = body.code.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

    log.info('Creating department', { name: body.name, code });

    // Check for duplicates
    const existing = await sql`
      SELECT id FROM departments
      WHERE (LOWER(name) = LOWER(${body.name}) OR code = ${code})
        AND is_active = true
    ` as { id: string }[];

    if (existing.length > 0) {
      return apiResponse.badRequest(res, 'Department with this name or code already exists');
    }

    // Create department
    const result = await sql`
      INSERT INTO departments (name, code, description, manager_id)
      VALUES (${body.name.trim()}, ${code}, ${body.description || null}, ${body.managerId || null})
      RETURNING
        id,
        name,
        code,
        description,
        manager_id as "managerId",
        is_active as "isActive",
        created_at as "createdAt",
        updated_at as "updatedAt"
    ` as Department[];

    log.info('Department created', { id: result[0]?.id, name: body.name });

    return apiResponse.created(res, {
      ...result[0],
      staffCount: 0,
      activeCount: 0,
      onLeaveCount: 0,
    } as Department);
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(handler);
