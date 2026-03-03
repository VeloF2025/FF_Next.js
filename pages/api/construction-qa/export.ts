/**
 * Construction QA - Excel Export API
 * GET /api/construction-qa/export?projectId=UUID&dateFrom=...&dateTo=...&discipline=...
 *
 * Exports filtered feature/review data to Excel (.xlsx).
 * Same filter logic as zone-hierarchy + pon-features.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth/middleware';
import * as XLSX from 'xlsx';

const sql = neon(process.env.DATABASE_URL!);

function toExcel(rows: Record<string, unknown>[], projectName: string): Buffer {
  const headers = [
    'Feature ID',
    'Type',
    'Discipline',
    'Zone',
    'PON',
    'Photos',
    'AI Confidence',
    'VLM Status',
    'Workflow Status',
    'QA Decision',
    'Priority',
    'Created',
    'Updated',
  ];

  const data = rows.map((r) => [
    r.feature_id,
    r.feature_type || '',
    r.discipline || '',
    r.zone_no != null ? r.zone_no : 'Unassigned',
    r.pon_no != null ? r.pon_no : 'Unassigned',
    Number(r.photo_count) || 0,
    r.vlm_confidence != null ? `${Math.round(Number(r.vlm_confidence) * 100)}%` : '',
    r.vlm_status || '',
    r.workflow_status || '',
    r.qa_decision || '',
    r.priority || '',
    r.created_at ? new Date(r.created_at as string).toISOString().slice(0, 16).replace('T', ' ') : '',
    r.updated_at ? new Date(r.updated_at as string).toISOString().slice(0, 16).replace('T', ' ') : '',
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  ws['!cols'] = [
    { wch: 18 }, // Feature ID
    { wch: 14 }, // Type
    { wch: 10 }, // Discipline
    { wch: 6 },  // Zone
    { wch: 6 },  // PON
    { wch: 7 },  // Photos
    { wch: 12 }, // AI Confidence
    { wch: 12 }, // VLM Status
    { wch: 14 }, // Workflow Status
    { wch: 10 }, // QA Decision
    { wch: 8 },  // Priority
    { wch: 16 }, // Created
    { wch: 16 }, // Updated
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, projectName.slice(0, 31) || 'Export');

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  const projectId = req.query.projectId as string;
  if (!projectId) {
    return apiResponse.badRequest(res, 'projectId is required');
  }

  const discipline = req.query.discipline as string || '';
  const dateFrom = req.query.dateFrom as string || '';
  const dateTo = req.query.dateTo as string || '';

  try {
    const conditions: string[] = ['r.project_id = $1::uuid'];
    const params: (string | number)[] = [projectId];
    let paramIdx = 2;

    if (discipline) {
      conditions.push(`r.discipline = $${paramIdx}`);
      params.push(discipline);
      paramIdx++;
    }

    if (dateFrom) {
      conditions.push(`r.created_at >= $${paramIdx}::timestamptz`);
      params.push(dateFrom);
      paramIdx++;
    }

    if (dateTo) {
      conditions.push(`r.created_at < $${paramIdx}::timestamptz`);
      params.push(dateTo);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    // Get project name for filename
    const projectRows = await sql.query(
      'SELECT project_name FROM projects WHERE id = $1::uuid',
      [projectId]
    );
    const projectName = (projectRows[0]?.project_name as string) || 'project';

    const query = `
      SELECT
        r.feature_id,
        r.feature_type,
        r.discipline,
        r.zone_no,
        r.pon_no,
        r.photo_count,
        r.vlm_confidence,
        r.vlm_status,
        r.workflow_status,
        r.qa_decision,
        r.priority,
        r.created_at,
        r.updated_at
      FROM construction_qa_reviews r
      WHERE ${whereClause}
      ORDER BY r.zone_no NULLS LAST, r.pon_no NULLS LAST, r.feature_id
    `;

    const rows = await sql.query(query, params);

    log.info('CQA export', `Exporting ${rows.length} rows for ${projectName}`, {
      module: 'construction-qa',
      projectId,
      discipline,
      dateFrom,
      dateTo,
    });

    const excel = toExcel(rows, projectName);

    const datePart = new Date().toISOString().slice(0, 10);
    const safeName = projectName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
    const filename = `field-ops-${safeName}-${datePart}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Count', String(rows.length));
    return res.status(200).send(excel);
  } catch (error) {
    log.error('CQA export error', {
      module: 'construction-qa',
      error: (error as Error).message,
    });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
