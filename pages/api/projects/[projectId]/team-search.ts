/**
 * Team Member Search API
 * GET /api/projects/[projectId]/team-search?q=term&type=staff|contractor
 *
 * Searches staff and contractors for the team member picker.
 * Excludes people already assigned to this project.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const getSql = () => neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { projectId, q, type } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.validationError(res, { projectId: 'Required' });
  }

  const searchTerm = typeof q === 'string' ? q.trim() : '';
  const filterType = typeof type === 'string' ? type : 'all';

  try {
    const sql = getSql();
    const results: Array<{ id: string; name: string; type: 'staff' | 'contractor'; position?: string; email?: string }> = [];

    if (filterType === 'all' || filterType === 'staff') {
      const staffRows = searchTerm
        ? await sql`
            SELECT s.id, COALESCE(s.name, s.first_name || ' ' || s.last_name) as name,
                   s.position, s.email
            FROM staff s
            WHERE s.is_active = true
              AND s.id NOT IN (
                SELECT sp.staff_id FROM staff_projects sp
                WHERE sp.project_id = ${projectId} AND sp.is_active = true
              )
              AND (
                s.name ILIKE ${'%' + searchTerm + '%'}
                OR s.first_name ILIKE ${'%' + searchTerm + '%'}
                OR s.last_name ILIKE ${'%' + searchTerm + '%'}
                OR s.email ILIKE ${'%' + searchTerm + '%'}
              )
            ORDER BY s.name, s.first_name
            LIMIT 20
          `
        : await sql`
            SELECT s.id, COALESCE(s.name, s.first_name || ' ' || s.last_name) as name,
                   s.position, s.email
            FROM staff s
            WHERE s.is_active = true
              AND s.id NOT IN (
                SELECT sp.staff_id FROM staff_projects sp
                WHERE sp.project_id = ${projectId} AND sp.is_active = true
              )
            ORDER BY s.name, s.first_name
            LIMIT 20
          `;

      for (const row of staffRows) {
        results.push({ id: row.id, name: row.name, type: 'staff', position: row.position, email: row.email });
      }
    }

    if (filterType === 'all' || filterType === 'contractor') {
      const contractorRows = searchTerm
        ? await sql`
            SELECT c.id, c.company_name as name, c.email
            FROM contractors c
            WHERE c.is_active = true
              AND c.id NOT IN (
                SELECT cp.contractor_id FROM contractor_projects cp
                WHERE cp.project_id = ${projectId} AND cp.is_active = true
              )
              AND (
                c.company_name ILIKE ${'%' + searchTerm + '%'}
                OR c.email ILIKE ${'%' + searchTerm + '%'}
              )
            ORDER BY c.company_name
            LIMIT 10
          `
        : await sql`
            SELECT c.id, c.company_name as name, c.email
            FROM contractors c
            WHERE c.is_active = true
              AND c.id NOT IN (
                SELECT cp.contractor_id FROM contractor_projects cp
                WHERE cp.project_id = ${projectId} AND cp.is_active = true
              )
            ORDER BY c.company_name
            LIMIT 10
          `;

      for (const row of contractorRows) {
        results.push({ id: row.id, name: row.name, type: 'contractor', email: row.email });
      }
    }

    return apiResponse.success(res, results);
  } catch (error) {
    log.error('Error searching team candidates', { error, projectId, q });
    return apiResponse.internalError(res, error as Error);
  }
}

export default withAuth(handler);
