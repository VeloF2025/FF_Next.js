/**
 * Site Visits API — Project scope
 *
 * GET  /api/projects/[projectId]/site-visits  — list visits for a project
 * POST /api/projects/[projectId]/site-visits  — schedule a new visit
 *
 * Protected by auth middleware.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type {
  SiteVisitWithDetails,
  SiteVisitFormData,
  SiteVisitType,
  SiteVisitStatus,
} from '@/types/site-visit.types';
import { SITE_VISIT_TYPES } from '@/types/site-visit.types';

// ==================== Row type from DB ====================

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

// ==================== Mapper ====================

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
  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'Invalid project ID');
  }

  const [project] = await sql`
    SELECT id FROM projects WHERE id = ${projectId}
  `;
  if (!project) {
    return apiResponse.notFound(res, 'Project not found');
  }

  if (req.method === 'GET') {
    return handleGet(req, res, projectId);
  }
  if (req.method === 'POST') {
    return handlePost(req, res, projectId);
  }

  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
}

// ==================== GET ====================

async function handleGet(req: NextApiRequest, res: NextApiResponse, projectId: string) {
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
      WHERE sv.project_id = ${projectId}
        AND (${status ?? null}::text IS NULL OR sv.status = ${status ?? null}::site_visit_status)
        AND (${fromDate ?? null}::date IS NULL OR sv.scheduled_date >= ${fromDate ?? null}::date)
        AND (${toDate ?? null}::date IS NULL OR sv.scheduled_date <= ${toDate ?? null}::date)
      ORDER BY sv.scheduled_date DESC, sv.created_at DESC
    `) as unknown as SiteVisitRow[];

    return res.status(200).json({ data: rows.map(mapRow) });
  } catch (error) {
    log.error('Error fetching site visits by project', { error, projectId });
    return apiResponse.internalError(res, new Error('Failed to fetch site visits'));
  }
}

// ==================== POST ====================

async function handlePost(req: NextApiRequest, res: NextApiResponse, projectId: string) {
  try {
    const body = req.body as SiteVisitFormData;

    if (!body.scheduledDate || typeof body.scheduledDate !== 'string') {
      return apiResponse.badRequest(res, 'scheduledDate is required (YYYY-MM-DD)');
    }
    if (!body.visitType || !(SITE_VISIT_TYPES as readonly string[]).includes(body.visitType)) {
      return apiResponse.badRequest(res, `visitType must be one of: ${SITE_VISIT_TYPES.join(', ')}`);
    }
    if (!body.inspectorName || typeof body.inspectorName !== 'string' || !body.inspectorName.trim()) {
      return apiResponse.badRequest(res, 'inspectorName is required');
    }

    // Validate contractor if provided
    if (body.contractorId) {
      const [contractor] = await sql`
        SELECT id FROM contractors WHERE id = ${body.contractorId}
      `;
      if (!contractor) {
        return apiResponse.badRequest(res, 'contractorId not found');
      }
    }

    const contractorId = body.contractorId ?? null;
    const notes = body.notes ?? null;
    const inspectorId = (req as AuthenticatedNextApiRequest).user.id;

    const inserted = (await sql`
      INSERT INTO site_visits
        (project_id, contractor_id, scheduled_date, visit_type, status,
         inspector_name, inspector_id, notes)
      VALUES
        (${projectId}, ${contractorId}, ${body.scheduledDate}, ${body.visitType}::site_visit_type,
         'scheduled'::site_visit_status, ${body.inspectorName.trim()}, ${inspectorId}, ${notes})
      RETURNING id
    `) as unknown as Array<{ id: string }>;

    const insertedId = inserted[0]?.id;
    if (!insertedId) {
      return apiResponse.internalError(res, new Error('Insert returned no rows'));
    }

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
      WHERE sv.id = ${insertedId}
    `) as unknown as SiteVisitRow[];

    if (!fullRows[0]) {
      return apiResponse.internalError(res, new Error('Could not retrieve inserted visit'));
    }

    return res.status(201).json({ data: mapRow(fullRows[0]) });
  } catch (error) {
    log.error('Error scheduling site visit', { error, projectId });
    return apiResponse.internalError(res, new Error('Failed to schedule site visit'));
  }
}

export default withAuth(handler);
