/**
 * Snag Reports API
 * GET  /api/snags/reports?projectId=X&page=1&pageSize=20
 * POST /api/snags/reports — Create a new TQR report record
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { SnagReport, CreateSnagReportRequest } from '@/modules/construction-qa/types/snag.types';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res);
      case 'POST':
        return await handlePost(req, res);
      case 'DELETE':
        return await handleDelete(req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET', 'POST', 'DELETE']);
    }
  } catch (error) {
    log.error('Snag reports API error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { projectId, page = '1', pageSize = '20' } = req.query;
  const pageNum = Math.max(1, parseInt(page as string, 10));
  const pageSizeNum = Math.min(100, parseInt(pageSize as string, 10));
  const offset = (pageNum - 1) * pageSizeNum;

  if (projectId && typeof projectId === 'string') {
    const rows = await sql`
      SELECT
        sr.*,
        p.project_name AS project_name
      FROM snag_reports sr
      INNER JOIN projects p ON p.id = sr.project_id
      WHERE sr.project_id = ${projectId}
      ORDER BY sr.audit_date DESC
      LIMIT ${pageSizeNum} OFFSET ${offset}
    ` as Array<SnagReport & { project_name: string }>;

    const countRows = await sql`
      SELECT COUNT(*) AS total
      FROM snag_reports
      WHERE project_id = ${projectId}
    ` as Array<{ total: string }>;

    const total = parseInt(countRows[0]?.total ?? '0', 10);

    return apiResponse.paginated(res, rows, {
      page: pageNum,
      pageSize: pageSizeNum,
      total,
    });
  }

  // No projectId filter — return all reports
  const rows = await sql`
    SELECT
      sr.*,
      p.project_name AS project_name
    FROM snag_reports sr
    INNER JOIN projects p ON p.id = sr.project_id
    ORDER BY sr.audit_date DESC
    LIMIT ${pageSizeNum} OFFSET ${offset}
  ` as Array<SnagReport & { project_name: string }>;

  const countRows = await sql`
    SELECT COUNT(*) AS total FROM snag_reports
  ` as Array<{ total: string }>;

  const total = parseInt(countRows[0]?.total ?? '0', 10);

  return apiResponse.paginated(res, rows, {
    page: pageNum,
    pageSize: pageSizeNum,
    total,
  });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = req.body as CreateSnagReportRequest;

  if (!body.project_id) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'project_id is required');
  }
  if (!body.report_number || !body.report_number.trim()) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'report_number is required');
  }
  if (!body.audit_date) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'audit_date is required');
  }

  const rows = await sql`
    INSERT INTO snag_reports (
      project_id, report_number, site_name, client, contractor,
      audit_date, auditor, source_pdf_url, source_pdf_filename,
      quality_assurance, quality_nc,
      health_assurance, health_nc,
      safety_assurance, safety_nc,
      environment_assurance, environment_nc,
      traffic_assurance, traffic_nc,
      import_status
    ) VALUES (
      ${body.project_id},
      ${body.report_number.trim()},
      ${body.site_name ?? null},
      ${body.client ?? 'Fibertime'},
      ${body.contractor ?? 'Velocity Fibre'},
      ${body.audit_date},
      ${body.auditor ?? null},
      ${body.source_pdf_url ?? null},
      ${body.source_pdf_filename ?? null},
      ${body.quality_assurance ?? 0},
      ${body.quality_nc ?? 0},
      ${body.health_assurance ?? 0},
      ${body.health_nc ?? 0},
      ${body.safety_assurance ?? 0},
      ${body.safety_nc ?? 0},
      ${body.environment_assurance ?? 0},
      ${body.environment_nc ?? 0},
      ${body.traffic_assurance ?? 0},
      ${body.traffic_nc ?? 0},
      'pending'
    )
    RETURNING *
  ` as SnagReport[];

  if (!rows[0]) {
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to create snag report');
  }

  log.info('Snag report created', { reportId: rows[0].id, reportNumber: rows[0].report_number });
  return apiResponse.created(res, rows[0]);
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'id query parameter is required');
  }

  // Verify the report exists before deleting
  const existing = await sql`
    SELECT id FROM snag_reports WHERE id = ${id}
  ` as Array<{ id: string }>;

  if (existing.length === 0) {
    return apiResponse.notFound(res, 'Snag report', id);
  }

  // CASCADE in the DB schema handles snags and snag_photos deletion
  await sql`
    DELETE FROM snag_reports WHERE id = ${id}
  `;

  log.info('Snag report deleted', { reportId: id });
  return apiResponse.success(res, { id }, 'Report deleted');
}

export default withAuth(handler);
