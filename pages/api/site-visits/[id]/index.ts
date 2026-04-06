/**
 * Site Visit Detail API
 *
 * PATCH /api/site-visits/[id] — update a visit (mark complete, add findings, cancel)
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
  UpdateVisitFormData,
  SiteVisitType,
  SiteVisitStatus,
} from '@/types/site-visit.types';
import { SITE_VISIT_STATUSES } from '@/types/site-visit.types';

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
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Invalid visit ID');
  }

  const [existing] = await sql`
    SELECT id FROM site_visits WHERE id = ${id}
  `;
  if (!existing) {
    return apiResponse.notFound(res, 'Site visit not found');
  }

  if (req.method === 'PATCH') {
    return handlePatch(req, res, id);
  }

  return apiResponse.methodNotAllowed(res, req.method!, ['PATCH']);
}

// ==================== PATCH ====================

async function handlePatch(req: NextApiRequest, res: NextApiResponse, id: string) {
  try {
    const body = req.body as UpdateVisitFormData;

    // Validate status if provided
    if (body.status !== undefined && !(SITE_VISIT_STATUSES as readonly string[]).includes(body.status)) {
      return apiResponse.badRequest(res, `status must be one of: ${SITE_VISIT_STATUSES.join(', ')}`);
    }

    // Build update fields dynamically — only update fields that are provided
    // Re-fetch current row first to merge
    const currentRows = (await sql`
      SELECT * FROM site_visits WHERE id = ${id}
    `) as unknown as Array<{
      status: SiteVisitStatus;
      actual_date: string | null;
      findings: string | null;
      action_items: string[] | null;
      notes: string | null;
      inspector_name: string;
    }>;

    const current = currentRows[0];
    if (!current) {
      return apiResponse.notFound(res, 'Site visit not found');
    }

    const newStatus = body.status ?? current.status;
    const newActualDate = body.actualDate !== undefined ? body.actualDate : current.actual_date;
    const newFindings = body.findings !== undefined ? body.findings : current.findings;
    const newActionItems = body.actionItems !== undefined ? body.actionItems : (current.action_items ?? []);
    const newNotes = body.notes !== undefined ? body.notes : current.notes;
    const newInspectorName = body.inspectorName !== undefined ? body.inspectorName.trim() : current.inspector_name;

    await sql`
      UPDATE site_visits SET
        status = ${newStatus}::site_visit_status,
        actual_date = ${newActualDate ?? null},
        findings = ${newFindings ?? null},
        action_items = ${newActionItems},
        notes = ${newNotes ?? null},
        inspector_name = ${newInspectorName}
      WHERE id = ${id}
    `;

    const fullRows = (await sql`
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
      WHERE sv.id = ${id}
    `) as unknown as SiteVisitRow[];

    if (!fullRows[0]) {
      return apiResponse.internalError(res, new Error('Could not retrieve updated visit'));
    }

    return res.status(200).json({ data: mapRow(fullRows[0]) });
  } catch (error) {
    log.error('Error updating site visit', { error, id });
    return apiResponse.internalError(res, new Error('Failed to update site visit'));
  }
}

export default withAuth(handler);
