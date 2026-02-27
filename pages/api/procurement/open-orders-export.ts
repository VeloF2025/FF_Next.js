/**
 * Open Orders CSV Export
 * GET — export all active PRs + POs as CSV
 *
 * Query params: projectId (optional)
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
  { key: 'type', label: 'Type' },
  { key: 'number', label: 'Number' },
  { key: 'status', label: 'Status' },
  { key: 'project', label: 'Project' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'amount', label: 'Amount' },
  { key: 'docDate', label: 'Doc Date' },
  { key: 'dueDate', label: 'Due Date' },
  { key: 'itemCount', label: 'Item Count' },
  { key: 'pendingApproval', label: 'Pending Approval' },
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  try {
    const { projectId } = req.query;

    // Active Purchase Requisitions
    const prs = projectId
      ? await sql`
          SELECT pr.requisition_number AS number, pr.status,
            pr.estimated_total AS amount, pr.requested_date AS doc_date,
            pr.required_date, p.project_name,
            (SELECT COUNT(*)::int FROM purchase_requisition_items WHERE requisition_id = pr.id) AS item_count,
            ar.id AS approval_request_id
          FROM purchase_requisitions pr
          LEFT JOIN projects p ON pr.project_id = p.id
          LEFT JOIN approval_requests ar ON ar.document_id = pr.id AND ar.document_type = 'purchase_requisition' AND ar.status = 'pending'
          WHERE pr.status NOT IN ('ordered', 'cancelled')
            AND pr.project_id = ${projectId as string}
          ORDER BY pr.requested_date DESC
        `
      : await sql`
          SELECT pr.requisition_number AS number, pr.status,
            pr.estimated_total AS amount, pr.requested_date AS doc_date,
            pr.required_date, p.project_name,
            (SELECT COUNT(*)::int FROM purchase_requisition_items WHERE requisition_id = pr.id) AS item_count,
            ar.id AS approval_request_id
          FROM purchase_requisitions pr
          LEFT JOIN projects p ON pr.project_id = p.id
          LEFT JOIN approval_requests ar ON ar.document_id = pr.id AND ar.document_type = 'purchase_requisition' AND ar.status = 'pending'
          WHERE pr.status NOT IN ('ordered', 'cancelled')
          ORDER BY pr.requested_date DESC
        `;

    // Active Purchase Orders
    const pos = projectId
      ? await sql`
          SELECT po.po_number AS number, po.status,
            po.total_amount AS amount, po.order_date AS doc_date,
            po.expected_delivery_date, p.project_name,
            COALESCE(s.company_name, s.name) AS supplier_name,
            (SELECT COUNT(*)::int FROM purchase_order_items WHERE purchase_order_id = po.id) AS item_count,
            ar.id AS approval_request_id
          FROM purchase_orders po
          LEFT JOIN projects p ON po.project_id = p.id
          LEFT JOIN suppliers s ON po.supplier_id = s.id
          LEFT JOIN approval_requests ar ON ar.document_id = po.id AND ar.document_type = 'purchase_order' AND ar.status = 'pending'
          WHERE po.status NOT IN ('cancelled', 'received', 'closed', 'completed')
            AND po.project_id = ${projectId as string}
          ORDER BY po.order_date DESC NULLS LAST, po.created_at DESC
        `
      : await sql`
          SELECT po.po_number AS number, po.status,
            po.total_amount AS amount, po.order_date AS doc_date,
            po.expected_delivery_date, p.project_name,
            COALESCE(s.company_name, s.name) AS supplier_name,
            (SELECT COUNT(*)::int FROM purchase_order_items WHERE purchase_order_id = po.id) AS item_count,
            ar.id AS approval_request_id
          FROM purchase_orders po
          LEFT JOIN projects p ON po.project_id = p.id
          LEFT JOIN suppliers s ON po.supplier_id = s.id
          LEFT JOIN approval_requests ar ON ar.document_id = po.id AND ar.document_type = 'purchase_order' AND ar.status = 'pending'
          WHERE po.status NOT IN ('cancelled', 'received', 'closed', 'completed')
          ORDER BY po.order_date DESC NULLS LAST, po.created_at DESC
        `;

    // Merge and sort
    const items = [
      ...prs.map((r) => ({
        type: 'PR',
        number: r.number as string,
        status: r.status as string,
        project: (r.project_name as string) || '',
        supplier: '',
        amount: r.amount ? Number(r.amount) : 0,
        docDate: (r.doc_date as string) || '',
        dueDate: (r.required_date as string) || '',
        itemCount: Number(r.item_count),
        pendingApproval: r.approval_request_id ? 'Yes' : 'No',
      })),
      ...pos.map((r) => ({
        type: 'PO',
        number: r.number as string,
        status: r.status as string,
        project: (r.project_name as string) || '',
        supplier: (r.supplier_name as string) || '',
        amount: r.amount ? Number(r.amount) : 0,
        docDate: (r.doc_date as string) || '',
        dueDate: (r.expected_delivery_date as string) || '',
        itemCount: Number(r.item_count),
        pendingApproval: r.approval_request_id ? 'Yes' : 'No',
      })),
    ];

    items.sort((a, b) => {
      const da = a.docDate ? new Date(a.docDate).getTime() : 0;
      const db = b.docDate ? new Date(b.docDate).getTime() : 0;
      return db - da;
    });

    const totalAmount = items.reduce((s, i) => s + i.amount, 0);
    const totalsRow = { type: '', number: 'TOTAL', status: '', project: '', supplier: '', amount: totalAmount, docDate: '', dueDate: '', itemCount: items.length, pendingApproval: '' };

    const csv = buildCSV(columns, items, { totalsRow });
    const filename = `open-orders-${new Date().toISOString().split('T')[0]}.csv`;
    return sendCSV(res, csv, filename);
  } catch (err) {
    log.error('Failed to export open orders', { error: err }, 'open-orders-export');
    return apiResponse.internalError(res, err, 'Failed to export open orders');
  }
}

export default withAuth(withErrorHandler(handler));
