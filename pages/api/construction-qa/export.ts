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
import { withAuth, withPermission } from '@/lib/auth/middleware';
import * as XLSX from 'xlsx';

const sql = neon(process.env.DATABASE_URL!);

const CIVIL_STEPS = [
  { col: 'civil_step_01_before_photo', label: 'Before Photo' },
  { col: 'civil_step_02_during_photo', label: 'During Photo' },
  { col: 'civil_step_03_depth_photo', label: 'Depth Photo' },
  { col: 'civil_step_04_end_plates', label: 'End Plates' },
  { col: 'civil_step_05_compaction', label: 'Compaction' },
  { col: 'civil_step_06_level_check', label: 'Level Check' },
  { col: 'civil_step_07_after_photo', label: 'After Photo' },
];

function toExcel(rows: Record<string, unknown>[], projectName: string, approval: string): Buffer {
  const isUnapproved = approval === 'unapproved';

  const headers = [
    'Feature ID',
    'Type',
    'Discipline',
    'Zone',
    'PON',
    'Photos',
    'Steps Covered',
    'AI Confidence',
    'VLM Status',
    'Workflow Status',
    'QA Decision',
    'Priority',
    ...(isUnapproved ? ['Steps Outstanding', 'Missing Steps'] : []),
    ...CIVIL_STEPS.map(s => s.label),
    'Captured',
    'Created',
    'Updated',
  ];

  const data = rows.map((r) => {
    const stepsDone = CIVIL_STEPS.filter(s => Boolean(r[s.col])).length;
    const missingSteps = CIVIL_STEPS.filter(s => !r[s.col]).map(s => s.label);

    const base = [
      r.feature_id,
      r.feature_type || '',
      r.discipline || '',
      r.zone_no != null ? r.zone_no : 'Unassigned',
      r.pon_no != null ? r.pon_no : 'Unassigned',
      Number(r.photo_count) || 0,
      `${stepsDone}/7`,
      r.vlm_confidence != null ? `${Math.round(Number(r.vlm_confidence) * 100)}%` : '',
      r.vlm_status || '',
      r.workflow_status || '',
      r.qa_decision || '',
      r.priority || '',
    ];

    if (isUnapproved) {
      base.push(
        String(7 - stepsDone),
        missingSteps.join(', '),
      );
    }

    base.push(
      ...CIVIL_STEPS.map(s => r[s.col] ? 'Yes' : 'No'),
      r.last_photo_at ? new Date(r.last_photo_at as string).toISOString().slice(0, 16).replace('T', ' ') : '',
      r.created_at ? new Date(r.created_at as string).toISOString().slice(0, 16).replace('T', ' ') : '',
      r.updated_at ? new Date(r.updated_at as string).toISOString().slice(0, 16).replace('T', ' ') : '',
    );

    return base;
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  // Auto-size columns
  ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 2, 10) }));

  const sheetName = approval === 'approved' ? 'Approved'
    : approval === 'unapproved' ? 'Not Approved'
    : projectName.slice(0, 31);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Export');

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
  const approval = req.query.approval as string || '';

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
      conditions.push(`COALESCE(r.last_photo_at, r.created_at) >= $${paramIdx}::timestamptz`);
      params.push(dateFrom);
      paramIdx++;
    }

    if (dateTo) {
      conditions.push(`COALESCE(r.last_photo_at, r.created_at) < $${paramIdx}::timestamptz`);
      params.push(dateTo);
      paramIdx++;
    }

    if (approval === 'approved') {
      conditions.push(`r.workflow_status = 'approved'`);
    } else if (approval === 'unapproved') {
      conditions.push(`r.workflow_status != 'approved'`);
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
        r.civil_step_01_before_photo,
        r.civil_step_02_during_photo,
        r.civil_step_03_depth_photo,
        r.civil_step_04_end_plates,
        r.civil_step_05_compaction,
        r.civil_step_06_level_check,
        r.civil_step_07_after_photo,
        r.last_photo_at,
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
      approval,
    });

    const excel = toExcel(rows, projectName, approval);

    const datePart = new Date().toISOString().slice(0, 10);
    const safeName = projectName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
    const approvalSuffix = approval ? `-${approval}` : '';
    const filename = `field-ops-${safeName}${approvalSuffix}-${datePart}.xlsx`;

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

export default withAuth(withPermission('construction-qa.export')(handler));
