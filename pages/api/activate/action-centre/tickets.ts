/**
 * GET /api/activate/action-centre/tickets
 *
 * Returns NOC tickets that originated from Action Centre flows:
 *   - Linked from ft_billing_deductions.ticket_id (billing disputes)
 *   - Linked from oes_pp_data.ticket_id (pre-prov chase)
 *   - Linked from olt_mismatch_records.maintenance_ticket_id (OLT escalations)
 *   - Or source/source_type matches the Action Centre ticket families
 *
 * Query params:
 *   status   — 'open' (default) | 'resolved' | 'all'
 *   source   — 'deduction' | 'pre_prov' | 'olt' | 'all' (default)
 *   project  — ILIKE match on ticket.project_id → project_name
 *   search   — ticket_uid / dr_number / title ILIKE
 *   limit    — default 200, max 500
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';

const logger = createLogger('api/activate/action-centre/tickets');

type SourceBucket = 'deduction' | 'pre_prov' | 'olt';

interface ActionCentreTicket {
  ticketId: string;
  ticketUid: string;
  drNumber: string | null;
  title: string;
  status: string;
  priority: string | null;
  sourceBucket: SourceBucket | null;
  source: string | null;
  sourceType: string | null;
  category: string | null;
  project: string | null;
  ontSerial: string | null;
  createdAt: string;
  updatedAt: string;
}

const OPEN_STATUSES = ['open', 'assigned', 'in_progress', 'pending_qa', 'qa_in_progress', 'qa_rejected'];
const CLOSED_STATUSES = ['closed', 'cancelled', 'resolved', 'verified', 'qa_approved'];

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const statusFilter = String(req.query.status || 'open');
  const sourceFilter = String(req.query.source || 'all');
  const project = typeof req.query.project === 'string' ? req.query.project.trim() : null;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : null;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));

  const statusClause =
    statusFilter === 'open'
      ? `t.status = ANY($1::text[])`
      : statusFilter === 'resolved'
        ? `t.status = ANY($1::text[])`
        : `TRUE`;
  const statusParams: string[] =
    statusFilter === 'open' ? OPEN_STATUSES
      : statusFilter === 'resolved' ? CLOSED_STATUSES
      : [];

  // Build a "source bucket" identification via subqueries
  const sourceConditions: string[] = [];
  if (sourceFilter === 'all' || sourceFilter === 'deduction') {
    sourceConditions.push(`t.id IN (SELECT ticket_id FROM ft_billing_deductions WHERE ticket_id IS NOT NULL)`);
    sourceConditions.push(`t.source_type IN ('n4_unresolved')`);
  }
  if (sourceFilter === 'all' || sourceFilter === 'pre_prov') {
    sourceConditions.push(`t.id IN (SELECT ticket_id FROM oes_pp_data WHERE ticket_id IS NOT NULL)`);
    sourceConditions.push(`t.source = 'pp_data'`);
  }
  if (sourceFilter === 'all' || sourceFilter === 'olt') {
    sourceConditions.push(`t.id IN (SELECT maintenance_ticket_id FROM olt_mismatch_records WHERE maintenance_ticket_id IS NOT NULL)`);
    sourceConditions.push(`t.source = 'olt_mismatch'`);
  }
  if (sourceConditions.length === 0) {
    // Unknown source — fall back to deduction + pp + olt union
    sourceConditions.push(`t.source IN ('pp_data', 'olt_mismatch', 'weekly_report')`);
  }

  const params: unknown[] = [];
  const clauses: string[] = [];

  if (statusParams.length > 0) {
    params.push(statusParams);
    clauses.push(statusClause.replace('$1', `$${params.length}`));
  }

  // OR the source conditions together
  clauses.push(`(${sourceConditions.join(' OR ')})`);

  if (project) {
    params.push(project);
    clauses.push(`p.project_name ILIKE $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    const idx = params.length;
    clauses.push(`(t.ticket_uid ILIKE $${idx} OR t.dr_number ILIKE $${idx} OR t.title ILIKE $${idx})`);
  }

  params.push(limit);
  const limitIdx = params.length;

  try {
    const { rows } = await pool.query<{
      id: string; ticket_uid: string; dr_number: string | null; title: string;
      status: string; priority: string | null; source: string | null;
      source_type: string | null; ticket_category: string | null; ont_serial: string | null;
      project_name: string | null; created_at: string; updated_at: string;
      has_deduction: boolean; has_pp: boolean; has_olt: boolean;
    }>(
      `SELECT t.id, t.ticket_uid, t.dr_number, t.title, t.status, t.priority,
              t.source, t.source_type, t.ticket_category, t.ont_serial,
              p.project_name,
              t.created_at::text, t.updated_at::text,
              EXISTS (SELECT 1 FROM ft_billing_deductions WHERE ticket_id = t.id)        AS has_deduction,
              EXISTS (SELECT 1 FROM oes_pp_data WHERE ticket_id = t.id)                 AS has_pp,
              EXISTS (SELECT 1 FROM olt_mismatch_records WHERE maintenance_ticket_id = t.id) AS has_olt
         FROM maintenance_tickets t
         LEFT JOIN projects p ON p.id = t.project_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY t.created_at DESC
        LIMIT $${limitIdx}`,
      params,
    );

    const items: ActionCentreTicket[] = rows.map((r) => {
      let bucket: SourceBucket | null = null;
      if (r.has_deduction || r.source_type === 'n4_unresolved') bucket = 'deduction';
      else if (r.has_pp || r.source === 'pp_data') bucket = 'pre_prov';
      else if (r.has_olt || r.source === 'olt_mismatch') bucket = 'olt';

      return {
        ticketId: r.id,
        ticketUid: r.ticket_uid,
        drNumber: r.dr_number,
        title: r.title,
        status: r.status,
        priority: r.priority,
        sourceBucket: bucket,
        source: r.source,
        sourceType: r.source_type,
        category: r.ticket_category,
        project: r.project_name,
        ontSerial: r.ont_serial,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });

    return apiResponse.success(res, {
      count: items.length,
      items,
      filters: { status: statusFilter, source: sourceFilter, project, search },
    });
  } catch (err) {
    logger.error('tickets failed', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
