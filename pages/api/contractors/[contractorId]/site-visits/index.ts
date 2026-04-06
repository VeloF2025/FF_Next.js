/**
 * Site Visits API — Contractor scope
 *
 * GET /api/contractors/[contractorId]/site-visits — list visits for a contractor
 *
 * Protected by auth middleware.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type {
  SiteVisitWithDetails,
  SiteVisitType,
  SiteVisitStatus,
} from '@/types/site-visit.types';

// ==================== Row type ====================

interface SiteVisitRow {
  id: string;
  project_id: string;
  contractor_id: string | null;
  scheduled_date: string;
  actual_date: string | null;
  visit_type: SiteVisitType;
  status: SiteVisitStatus;
  inspector_name: string;
  inspector_id: string | null;
  notes: string | null;
  findings: string | null;
  action_items: string[] | null;
  attachments: string[] | null;
  created_at: string;
  updated_at: string;
  project_name: string | null;
  project_code: string | null;
  contractor_name: string | null;
}

function mapRow(row: SiteVisitRow): SiteVisitWithDetails {
  return {
    id: row.id,
    projectId: row.project_id,
    contractorId: row.contractor_id,
    scheduledDate: row.scheduled_date,
    actualDate: row.actual_date,
    visitType: row.visit_type,
    status: row.status,
    inspectorName: row.inspector_name,
    inspectorId: row.inspector_id,
    notes: row.notes,
    findings: row.findings,
    actionItems: row.action_items ?? [],
    attachments: row.attachments ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    projectName: row.project_name,
    projectCode: row.project_code,
    contractorName: row.contractor_name,
  };
}

// ==================== Handler ====================

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { contractorId } = req.query;

  if (!contractorId || typeof contractorId !== 'string') {
    return apiResponse.badRequest(res, 'Invalid contractor ID');
  }

  const [contractor] = await sql`
    SELECT id FROM contractors WHERE id = ${contractorId}
  `;
  if (!contractor) {
    return apiResponse.notFound(res, 'Contractor not found');
  }

  if (req.method === 'GET') {
    return handleGet(req, res, contractorId);
  }

  return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
}

async function handleGet(req: NextApiRequest, res: NextApiResponse, contractorId: string) {
  try {
    const { status, fromDate, toDate } = req.query;

    const rows = (await sql`
      SELECT
        sv.id, sv.project_id, sv.contractor_id,
        sv.scheduled_date::text, sv.actual_date::text,
        sv.visit_type, sv.status,
        sv.inspector_name, sv.inspector_id,
        sv.notes, sv.findings,
        sv.action_items, sv.attachments,
        sv.created_at::text, sv.updated_at::text,
        p.project_name, p.project_code,
        c.company_name AS contractor_name
      FROM site_visits sv
      INNER JOIN projects p ON sv.project_id = p.id
      LEFT JOIN contractors c ON sv.contractor_id = c.id
      WHERE sv.contractor_id = ${contractorId}
        AND (${status ?? null}::text IS NULL OR sv.status = ${status ?? null}::site_visit_status)
        AND (${fromDate ?? null}::date IS NULL OR sv.scheduled_date >= ${fromDate ?? null}::date)
        AND (${toDate ?? null}::date IS NULL OR sv.scheduled_date <= ${toDate ?? null}::date)
      ORDER BY sv.scheduled_date DESC, sv.created_at DESC
    `) as unknown as SiteVisitRow[];

    return res.status(200).json({ data: rows.map(mapRow) });
  } catch (error) {
    log.error('Error fetching site visits by contractor', { error, contractorId });
    return apiResponse.internalError(res, new Error('Failed to fetch site visits'));
  }
}

export default withAuth(handler);
