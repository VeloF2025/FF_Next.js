/**
 * Ticket Summary API — lightweight status counts
 *
 * GET /api/noc/tickets/summary
 *
 * Returns { status: count } map via a single GROUP BY query.
 * Replaces fetching 2000+ rows just to count client-side.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { query } from '@/modules/noc/utils/db';

const logger = createLogger('noc:api:tickets:summary');

interface StatusCount {
  status: string;
  count: string;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Support same filters as ticket list (except pagination)
    const whereClauses: string[] = [];
    const values: (string | boolean)[] = [];
    let p = 1;

    const addFilter = (param: string, column: string) => {
      const val = searchParams.get(param);
      if (val) {
        whereClauses.push(`${column} = $${p++}`);
        values.push(val);
      }
    };

    addFilter('ticket_type', 'type');
    addFilter('priority', 'priority');
    addFilter('source', 'source');
    addFilter('assigned_to', 'assigned_to');
    addFilter('assigned_team_id', 'assigned_team_id');
    addFilter('project_id', 'project_id');
    addFilter('dr_number', 'dr_number');

    if (searchParams.has('qa_ready')) {
      whereClauses.push(`qa_verified = $${p++}`);
      values.push(searchParams.get('qa_ready') === 'true');
    }

    if (searchParams.has('sla_breached')) {
      whereClauses.push(`sla_breached = $${p++}`);
      values.push(searchParams.get('sla_breached') === 'true');
    }

    if (searchParams.has('created_after')) {
      whereClauses.push(`created_at >= $${p++}`);
      values.push(new Date(searchParams.get('created_after')!).toISOString());
    }

    if (searchParams.has('created_before')) {
      whereClauses.push(`created_at < $${p++}`);
      values.push(new Date(searchParams.get('created_before')!).toISOString());
    }

    // Search filter
    const search = searchParams.get('search')?.trim();
    if (search) {
      const term = `%${search}%`;
      whereClauses.push(`(ticket_uid ILIKE $${p} OR dr_number ILIKE $${p + 1} OR title ILIKE $${p + 2} OR description ILIKE $${p + 3})`);
      values.push(term, term, term, term);
      p += 4;
    }

    const whereClause = whereClauses.length > 0
      ? `WHERE ${whereClauses.join(' AND ')}`
      : '';

    const sql = `
      SELECT status, COUNT(*)::text as count
      FROM maintenance_tickets
      ${whereClause}
      GROUP BY status
    `;

    const rows = await query<StatusCount>(sql, values);

    // Build { status: number } map + total
    const counts: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      const c = parseInt(row.count, 10);
      counts[row.status] = c;
      total += c;
    }

    return NextResponse.json({
      success: true,
      data: { counts, total },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    logger.error('Error fetching ticket summary', { error });
    return NextResponse.json(
      {
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to fetch ticket summary' },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 500 }
    );
  }
}
