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

    // Normalise optional filter values — string or null, never raw array
    const s  = typeof status       === 'string' ? status       : null;
    const tc = typeof technicianId === 'string' ? technicianId : null;
    const pr = typeof priority     === 'string' ? priority     : null;
    const df = typeof dateFrom     === 'string' ? dateFrom     : null;
    const dt = typeof dateTo       === 'string' ? dateTo       : null;

    // 🟢 WORKING: explicit query branches using Neon tagged template literals.
    // Every user-supplied value is a driver-level parameter — no string
    // concatenation, no manual quoting, no sql.unsafe() with user data.
    // The static SQL fragments (BASE SELECT + ORDER BY) are safe to pass to
    // sql.unsafe() because they contain no user input.
    const BASE = `
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
    `;
    const TAIL = `
      ORDER BY
        CASE t.priority
          WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4
          ELSE 5
        END,
        t.due_date ASC NULLS LAST
      LIMIT 5000
    `;

    let rows: Record<string, unknown>[];

    // All 32 filter combinations (5 booleans → 2^5 = 32 branches)
    if (s && tc && pr && df && dt) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.status=${s} AND t.assigned_to::text=${tc} AND t.priority=${pr} AND t.due_date>=${df}::date AND t.due_date<=${dt}::date ${sql.unsafe(TAIL)}`;
    } else if (s && tc && pr && df) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.status=${s} AND t.assigned_to::text=${tc} AND t.priority=${pr} AND t.due_date>=${df}::date ${sql.unsafe(TAIL)}`;
    } else if (s && tc && pr && dt) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.status=${s} AND t.assigned_to::text=${tc} AND t.priority=${pr} AND t.due_date<=${dt}::date ${sql.unsafe(TAIL)}`;
    } else if (s && tc && df && dt) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.status=${s} AND t.assigned_to::text=${tc} AND t.due_date>=${df}::date AND t.due_date<=${dt}::date ${sql.unsafe(TAIL)}`;
    } else if (s && pr && df && dt) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.status=${s} AND t.priority=${pr} AND t.due_date>=${df}::date AND t.due_date<=${dt}::date ${sql.unsafe(TAIL)}`;
    } else if (tc && pr && df && dt) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.assigned_to::text=${tc} AND t.priority=${pr} AND t.due_date>=${df}::date AND t.due_date<=${dt}::date ${sql.unsafe(TAIL)}`;
    } else if (s && tc && pr) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.status=${s} AND t.assigned_to::text=${tc} AND t.priority=${pr} ${sql.unsafe(TAIL)}`;
    } else if (s && tc && df) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.status=${s} AND t.assigned_to::text=${tc} AND t.due_date>=${df}::date ${sql.unsafe(TAIL)}`;
    } else if (s && tc && dt) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.status=${s} AND t.assigned_to::text=${tc} AND t.due_date<=${dt}::date ${sql.unsafe(TAIL)}`;
    } else if (s && pr && df) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.status=${s} AND t.priority=${pr} AND t.due_date>=${df}::date ${sql.unsafe(TAIL)}`;
    } else if (s && pr && dt) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.status=${s} AND t.priority=${pr} AND t.due_date<=${dt}::date ${sql.unsafe(TAIL)}`;
    } else if (s && df && dt) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.status=${s} AND t.due_date>=${df}::date AND t.due_date<=${dt}::date ${sql.unsafe(TAIL)}`;
    } else if (tc && pr && df) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.assigned_to::text=${tc} AND t.priority=${pr} AND t.due_date>=${df}::date ${sql.unsafe(TAIL)}`;
    } else if (tc && pr && dt) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.assigned_to::text=${tc} AND t.priority=${pr} AND t.due_date<=${dt}::date ${sql.unsafe(TAIL)}`;
    } else if (tc && df && dt) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.assigned_to::text=${tc} AND t.due_date>=${df}::date AND t.due_date<=${dt}::date ${sql.unsafe(TAIL)}`;
    } else if (pr && df && dt) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.priority=${pr} AND t.due_date>=${df}::date AND t.due_date<=${dt}::date ${sql.unsafe(TAIL)}`;
    } else if (s && tc) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.status=${s} AND t.assigned_to::text=${tc} ${sql.unsafe(TAIL)}`;
    } else if (s && pr) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.status=${s} AND t.priority=${pr} ${sql.unsafe(TAIL)}`;
    } else if (s && df) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.status=${s} AND t.due_date>=${df}::date ${sql.unsafe(TAIL)}`;
    } else if (s && dt) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.status=${s} AND t.due_date<=${dt}::date ${sql.unsafe(TAIL)}`;
    } else if (tc && pr) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.assigned_to::text=${tc} AND t.priority=${pr} ${sql.unsafe(TAIL)}`;
    } else if (tc && df) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.assigned_to::text=${tc} AND t.due_date>=${df}::date ${sql.unsafe(TAIL)}`;
    } else if (tc && dt) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.assigned_to::text=${tc} AND t.due_date<=${dt}::date ${sql.unsafe(TAIL)}`;
    } else if (pr && df) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.priority=${pr} AND t.due_date>=${df}::date ${sql.unsafe(TAIL)}`;
    } else if (pr && dt) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.priority=${pr} AND t.due_date<=${dt}::date ${sql.unsafe(TAIL)}`;
    } else if (df && dt) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.due_date>=${df}::date AND t.due_date<=${dt}::date ${sql.unsafe(TAIL)}`;
    } else if (s) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.status=${s} ${sql.unsafe(TAIL)}`;
    } else if (tc) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.assigned_to::text=${tc} ${sql.unsafe(TAIL)}`;
    } else if (pr) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.priority=${pr} ${sql.unsafe(TAIL)}`;
    } else if (df) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.due_date>=${df}::date ${sql.unsafe(TAIL)}`;
    } else if (dt) {
      rows = await sql`${sql.unsafe(BASE)} WHERE t.due_date<=${dt}::date ${sql.unsafe(TAIL)}`;
    } else {
      rows = await sql`${sql.unsafe(BASE)} ${sql.unsafe(TAIL)}`;
    }

    // Escape a CSV cell value
    const cell = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      const str = String(v);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"` : str;
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

    log.info('Field task export', { rowCount: rows.length, filters: { status: s, technicianId: tc, priority: pr, dateFrom: df, dateTo: dt } });
  } catch (error) {
    log.error('Field export error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
