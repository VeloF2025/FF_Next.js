/**
 * Field Task Export API
 * GET /api/field/export
 *
 * Exports real task data as CSV. Respects the same filters as /api/field/tasks.
 *
 * Query params:
 *   status       — filter by task status
 *   technicianId — filter by assigned_to user ID
 *   priority     — filter by priority
 *   dateFrom     — filter due_date >= (ISO date)
 *   dateTo       — filter due_date <= (ISO date)
 *
 * Formerly returned 3 hardcoded mock rows.
 * Now queries the real tasks table (2099+ rows).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { status, technicianId, priority, dateFrom, dateTo } = req.query;

    // Build WHERE clause
    const conditions: string[] = [];
    if (status)       conditions.push(`t.status = '${(status as string).replace(/'/g, "''")}'`);
    if (technicianId) conditions.push(`t.assigned_to = '${(technicianId as string).replace(/'/g, "''")}'`);
    if (priority)     conditions.push(`t.priority = '${(priority as string).replace(/'/g, "''")}'`);
    if (dateFrom)     conditions.push(`t.due_date >= '${(dateFrom as string).replace(/'/g, "''")}'`);
    if (dateTo)       conditions.push(`t.due_date <= '${(dateTo as string).replace(/'/g, "''")}'`);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await sql.unsafe(`
      SELECT
        t.id,
        t.title,
        t.category,
        t.status,
        t.priority,
        COALESCE(u.first_name || ' ' || u.last_name, t.assigned_to::text, '') AS technician,
        COALESCE(p.project_name, '') AS project,
        COALESCE(p.location, t.location, '') AS location,
        t.due_date,
        t.completed_at,
        t.notes,
        t.created_at
      FROM tasks t
      LEFT JOIN users    u ON u.id = t.assigned_to
      LEFT JOIN projects p ON p.id = t.project_id
      ${where}
      ORDER BY
        CASE t.priority
          WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4
          ELSE 5
        END,
        t.due_date ASC NULLS LAST
      LIMIT 5000
    `);

    // Escape a CSV cell value
    const cell = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const headers = ['Task ID', 'Title', 'Category', 'Status', 'Priority', 'Technician', 'Project', 'Location', 'Due Date', 'Completed At', 'Notes', 'Created At'];
    const csvRows = [
      headers.join(','),
      ...rows.map(r =>
        [r.id, r.title, r.category, r.status, r.priority, r.technician, r.project, r.location, r.due_date, r.completed_at, r.notes, r.created_at]
          .map(cell).join(',')
      ),
    ];

    const dateStr = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="field-tasks-${dateStr}.csv"`);
    res.status(200).send(csvRows.join('\n'));

    log.info('Field task export', { rowCount: rows.length, filters: { status, technicianId, priority, dateFrom, dateTo } });
  } catch (error) {
    log.error('Field export error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
