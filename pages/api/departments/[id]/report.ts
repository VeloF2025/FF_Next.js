/**
 * Department Report API
 * GET /api/departments/[id]/report - Get department analytics
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { createLogger } from '@/lib/logger';
import type { DepartmentReport } from '@/types/staff/department.types';

const log = createLogger('DepartmentReportAPI');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const sql = neon(process.env.DATABASE_URL!);
  const { id } = req.query;

  if (typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Invalid department ID');
  }

  log.info('Generating department report', { id });

  // Check department exists
  const dept = await sql`SELECT id, name FROM departments WHERE id = ${id}` as { id: string; name: string }[];
  if (dept.length === 0) {
    return apiResponse.notFound(res, 'Department', id);
  }

  // Staff by status
  const statusCounts = await sql`
    SELECT status, COUNT(*) as count
    FROM staff
    WHERE department_id = ${id}
    GROUP BY status
  ` as { status: string; count: string }[];

  const staffByStatus: Record<string, number> = {};
  for (const row of statusCounts) {
    staffByStatus[row.status] = Number(row.count);
  }

  // Compliance rate (staff with valid ID and required docs)
  const complianceData = await sql`
    SELECT
      COUNT(*) FILTER (WHERE s.id_number IS NOT NULL AND s.id_number != '') as with_id,
      COUNT(*) as total
    FROM staff s
    WHERE s.department_id = ${id}
      AND s.status NOT IN ('terminated', 'resigned', 'retired')
  ` as { with_id: string; total: string }[];

  const total = Number(complianceData[0]?.total) || 0;
  const withId = Number(complianceData[0]?.with_id) || 0;
  const complianceRate = total > 0 ? Math.round((withId / total) * 100) : 0;

  // Project count
  const projectData = await sql`
    SELECT COUNT(DISTINCT ps.project_id) as count
    FROM project_staff ps
    JOIN staff s ON ps.staff_id = s.id
    WHERE s.department_id = ${id}
      AND s.status NOT IN ('terminated', 'resigned', 'retired')
  ` as { count: string }[];

  const projectCount = Number(projectData[0]?.count) || 0;

  // Average tenure (in days)
  const tenureData = await sql`
    SELECT AVG(EXTRACT(DAY FROM NOW() - s.join_date::timestamp)) as avg_tenure
    FROM staff s
    WHERE s.department_id = ${id}
      AND s.join_date IS NOT NULL
      AND s.status NOT IN ('terminated', 'resigned', 'retired')
  ` as { avg_tenure: string | null }[];

  const avgTenureDays = Math.round(Number(tenureData[0]?.avg_tenure) || 0);

  // Certifications summary (if staff_certifications table exists)
  let certifications = { total: 0, expiringSoon: 0, expired: 0 };
  try {
    const certData = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE sc.expiry_date < NOW() + INTERVAL '30 days' AND sc.expiry_date >= NOW()) as expiring_soon,
        COUNT(*) FILTER (WHERE sc.expiry_date < NOW()) as expired
      FROM staff_certifications sc
      JOIN staff s ON sc.staff_id = s.id
      WHERE s.department_id = ${id}
        AND s.status NOT IN ('terminated', 'resigned', 'retired')
    ` as { total: string; expiring_soon: string; expired: string }[];
    certifications = {
      total: Number(certData[0]?.total) || 0,
      expiringSoon: Number(certData[0]?.expiring_soon) || 0,
      expired: Number(certData[0]?.expired) || 0,
    };
  } catch {
    // Table may not exist, use defaults
  }

  // Recent activity (last 30 days)
  interface ActivityRow {
    type: string;
    staffId: string;
    staffName: string;
    date: string;
    details: string;
  }

  const recentActivity = await sql`
    SELECT
      'joined' as type,
      s.id as "staffId",
      COALESCE(s.first_name || ' ' || s.last_name, s.name) as "staffName",
      s.join_date as date,
      'Joined the team' as details
    FROM staff s
    WHERE s.department_id = ${id}
      AND s.join_date >= NOW() - INTERVAL '30 days'
    UNION ALL
    SELECT
      'left' as type,
      s.id as "staffId",
      COALESCE(s.first_name || ' ' || s.last_name, s.name) as "staffName",
      s.end_date as date,
      'Left the company' as details
    FROM staff s
    WHERE s.department_id = ${id}
      AND s.end_date >= NOW() - INTERVAL '30 days'
      AND s.status IN ('terminated', 'resigned', 'retired')
    ORDER BY date DESC
    LIMIT 10
  ` as ActivityRow[];

  const report: DepartmentReport = {
    staffByStatus,
    complianceRate,
    projectCount,
    avgTenureDays,
    certifications,
    recentActivity: recentActivity.map((a) => ({
      type: a.type as 'joined' | 'left' | 'status_change' | 'project_assigned',
      staffId: a.staffId,
      staffName: a.staffName,
      date: a.date,
      details: a.details,
    })),
  };

  return apiResponse.success(res, report);
}

export default withAuth(handler);
