/**
 * Ticket Summary API — lightweight status + type counts
 *
 * GET /api/noc/tickets/summary
 *
 * Returns:
 *   - { status: count } map via GROUP BY status
 *   - { type: count } map via GROUP BY type (for T1 category grouping)
 *
 * Replaces fetching 2000+ rows just to count client-side.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { query, queryOne } from '@/modules/noc/utils/db';

const logger = createLogger('noc:api:tickets:summary');

interface StatusCount {
  status: string;
  count: string;
}

interface TypeCount {
  type: string;
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

    // status: supports both individual DB statuses and meta-groups (active/completed)
    const statusParam = searchParams.get('status');
    if (statusParam) {
      const ACTIVE_STATUSES = ['open', 'assigned', 'in_progress', 'pending_qa'];
      const COMPLETED_STATUSES = ['resolved', 'verified', 'closed'];

      if (statusParam === 'active') {
        const placeholders = ACTIVE_STATUSES.map((_, i) => `$${p + i}`).join(', ');
        whereClauses.push(`status IN (${placeholders})`);
        values.push(...ACTIVE_STATUSES);
        p += ACTIVE_STATUSES.length;
      } else if (statusParam === 'completed') {
        const placeholders = COMPLETED_STATUSES.map((_, i) => `$${p + i}`).join(', ');
        whereClauses.push(`status IN (${placeholders})`);
        values.push(...COMPLETED_STATUSES);
        p += COMPLETED_STATUSES.length;
      } else {
        whereClauses.push(`status = $${p++}`);
        values.push(statusParam);
      }
    }

    // ticket_type supports multiple values (T1 category expansion)
    const ticketTypes = searchParams.getAll('ticket_type');
    if (ticketTypes.length === 1) {
      whereClauses.push(`type = $${p++}`);
      values.push(ticketTypes[0]!);
    } else if (ticketTypes.length > 1) {
      const placeholders = ticketTypes.map((_, i) => `$${p + i}`).join(', ');
      whereClauses.push(`type IN (${placeholders})`);
      values.push(...ticketTypes);
      p += ticketTypes.length;
    }
    addFilter('priority', 'priority');
    addFilter('source', 'source');

    // assigned_to: column stores staff.id but auth passes users.id — need lookup
    const assignedTo = searchParams.get('assigned_to');
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (assignedTo && uuidRegex.test(assignedTo)) {
      const staffLookup = await queryOne<{ id: string }>(
        `SELECT id FROM staff WHERE user_id = $1 LIMIT 1`,
        [assignedTo]
      );
      if (!staffLookup) {
        logger.warn('No staff record found for user_id — "My Tickets" counts may be inaccurate', { user_id: assignedTo });
      }
      const resolvedId = staffLookup?.id || assignedTo;
      whereClauses.push(`assigned_to = $${p++}`);
      values.push(resolvedId);
    }

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

    const statusSql = `
      SELECT status, COUNT(*)::text as count
      FROM maintenance_tickets
      ${whereClause}
      GROUP BY status
    `;

    const typeSql = `
      SELECT type, COUNT(*)::text as count
      FROM maintenance_tickets
      ${whereClause}
      GROUP BY type
    `;

    const [statusRows, typeRows] = await Promise.all([
      query<StatusCount>(statusSql, values),
      query<TypeCount>(typeSql, values),
    ]);

    // Build { status: number } map + total
    const counts: Record<string, number> = {};
    let total = 0;
    for (const row of statusRows) {
      const c = parseInt(row.count, 10);
      counts[row.status] = c;
      total += c;
    }

    // Build { type: number } map for T1 category grouping client-side
    const typeCounts: Record<string, number> = {};
    for (const row of typeRows) {
      typeCounts[row.type] = parseInt(row.count, 10);
    }

    return NextResponse.json({
      success: true,
      data: { counts, total, typeCounts },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    logger.error('Error fetching ticket summary', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
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
