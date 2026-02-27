/**
 * Purchase Requisitions CSV Export
 * GET — export requisitions as CSV with optional filters
 *
 * Query params: status, search
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { buildCSV, sendCSV, type CSVColumn } from '@/lib/csv';

const sql = neon(process.env.DATABASE_URL!);

const columns: CSVColumn[] = [
  { key: 'reqNumber', label: 'Req Number' },
  { key: 'status', label: 'Status' },
  { key: 'project', label: 'Project' },
  { key: 'costCentre', label: 'Cost Centre' },
  { key: 'department', label: 'Department' },
  { key: 'requestedBy', label: 'Requested By' },
  { key: 'requestedDate', label: 'Requested Date' },
  { key: 'requiredDate', label: 'Required Date' },
  { key: 'urgency', label: 'Urgency' },
  { key: 'estimatedTotal', label: 'Estimated Total' },
  { key: 'currency', label: 'Currency' },
  { key: 'items', label: 'Items' },
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  try {
    const { status, search } = req.query;

    const conditions: string[] = ['1=1'];
    const params: string[] = [];
    let idx = 1;

    if (status) {
      conditions.push(`pr.status = $${idx}`);
      params.push(status as string);
      idx++;
    }
    if (search) {
      conditions.push(`(pr.requisition_number ILIKE $${idx} OR p.project_name ILIKE $${idx} OR pr.requested_by_name ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const query = `
      SELECT
        pr.requisition_number, pr.status, p.project_name,
        cc.name as cost_center_name, pr.department, pr.requested_by_name,
        pr.requested_date, pr.required_date, pr.urgency,
        pr.estimated_total, pr.currency,
        (SELECT COUNT(*)::int FROM purchase_requisition_items WHERE requisition_id = pr.id) as item_count
      FROM purchase_requisitions pr
      LEFT JOIN projects p ON pr.project_id = p.id
      LEFT JOIN cost_centers cc ON pr.cost_center_id = cc.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY pr.created_at DESC
      LIMIT 10000
    `;

    const rows = await sql.query(query, params);

    const mapped = rows.map((r: Record<string, unknown>) => ({
      reqNumber: r.requisition_number,
      status: r.status,
      project: r.project_name || '',
      costCentre: r.cost_center_name || '',
      department: r.department || '',
      requestedBy: r.requested_by_name || '',
      requestedDate: r.requested_date || '',
      requiredDate: r.required_date || '',
      urgency: r.urgency || '',
      estimatedTotal: r.estimated_total ? Number(r.estimated_total) : 0,
      currency: r.currency || 'ZAR',
      items: r.item_count,
    }));

    const csv = buildCSV(columns, mapped);
    const filename = `requisitions-${new Date().toISOString().split('T')[0]}.csv`;
    return sendCSV(res, csv, filename);
  } catch (err) {
    log.error('Failed to export requisitions', { error: err }, 'requisitions-export');
    return apiResponse.internalError(res, err, 'Failed to export requisitions');
  }
}

export default withAuth(withErrorHandler(handler));
