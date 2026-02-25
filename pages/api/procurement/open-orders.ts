/**
 * GET /api/procurement/open-orders
 *
 * Returns all active (open) purchase requisitions and purchase orders —
 * anything in the procurement pipeline not yet completed or cancelled.
 *
 * Query params:
 *   projectId? — filter to a specific project
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';

const sql = neon(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { projectId } = req.query;

  // ── Active Purchase Requisitions ─────────────────────────────────────────
  const prs = projectId
    ? await sql`
        SELECT
          pr.id,
          pr.requisition_number AS number,
          pr.status,
          pr.estimated_total AS amount,
          pr.urgency,
          pr.requested_date AS doc_date,
          pr.required_date,
          pr.requested_by_name AS requester_name,
          pr.notes,
          p.project_name AS project_name,
          p.project_code AS project_code,
          p.id AS project_id,
          (SELECT COUNT(*)::int FROM purchase_requisition_items WHERE requisition_id = pr.id) AS item_count,
          ar.id AS approval_request_id
        FROM purchase_requisitions pr
        LEFT JOIN projects p ON pr.project_id = p.id
        LEFT JOIN approval_requests ar
          ON ar.document_id = pr.id
          AND ar.document_type = 'purchase_requisition'
          AND ar.status = 'pending'
        WHERE pr.status NOT IN ('ordered', 'cancelled')
          AND pr.project_id = ${projectId as string}
        ORDER BY pr.requested_date DESC
      `
    : await sql`
        SELECT
          pr.id,
          pr.requisition_number AS number,
          pr.status,
          pr.estimated_total AS amount,
          pr.urgency,
          pr.requested_date AS doc_date,
          pr.required_date,
          pr.requested_by_name AS requester_name,
          pr.notes,
          p.project_name AS project_name,
          p.project_code AS project_code,
          p.id AS project_id,
          (SELECT COUNT(*)::int FROM purchase_requisition_items WHERE requisition_id = pr.id) AS item_count,
          ar.id AS approval_request_id
        FROM purchase_requisitions pr
        LEFT JOIN projects p ON pr.project_id = p.id
        LEFT JOIN approval_requests ar
          ON ar.document_id = pr.id
          AND ar.document_type = 'purchase_requisition'
          AND ar.status = 'pending'
        WHERE pr.status NOT IN ('ordered', 'cancelled')
        ORDER BY pr.requested_date DESC
      `;

  // ── Active Purchase Orders ───────────────────────────────────────────────
  const pos = projectId
    ? await sql`
        SELECT
          po.id,
          po.po_number AS number,
          po.status,
          po.total_amount AS amount,
          po.order_date AS doc_date,
          po.expected_delivery_date,
          po.internal_notes AS notes,
          p.project_name AS project_name,
          p.project_code AS project_code,
          p.id AS project_id,
          COALESCE(s.company_name, s.name) AS supplier_name,
          (SELECT COUNT(*)::int FROM purchase_order_items WHERE purchase_order_id = po.id) AS item_count,
          ar.id AS approval_request_id
        FROM purchase_orders po
        LEFT JOIN projects p ON po.project_id = p.id
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        LEFT JOIN approval_requests ar
          ON ar.document_id = po.id
          AND ar.document_type = 'purchase_order'
          AND ar.status = 'pending'
        WHERE po.status NOT IN ('cancelled', 'received', 'closed', 'completed')
          AND po.project_id = ${projectId as string}
        ORDER BY po.order_date DESC NULLS LAST, po.created_at DESC
      `
    : await sql`
        SELECT
          po.id,
          po.po_number AS number,
          po.status,
          po.total_amount AS amount,
          po.order_date AS doc_date,
          po.expected_delivery_date,
          po.internal_notes AS notes,
          p.project_name AS project_name,
          p.project_code AS project_code,
          p.id AS project_id,
          COALESCE(s.company_name, s.name) AS supplier_name,
          (SELECT COUNT(*)::int FROM purchase_order_items WHERE purchase_order_id = po.id) AS item_count,
          ar.id AS approval_request_id
        FROM purchase_orders po
        LEFT JOIN projects p ON po.project_id = p.id
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        LEFT JOIN approval_requests ar
          ON ar.document_id = po.id
          AND ar.document_type = 'purchase_order'
          AND ar.status = 'pending'
        WHERE po.status NOT IN ('cancelled', 'received', 'closed', 'completed')
        ORDER BY po.order_date DESC NULLS LAST, po.created_at DESC
      `;

  // ── Typed response items ─────────────────────────────────────────────────
  type OpenOrderItem = {
    id: string;
    type: 'pr' | 'po';
    number: string;
    status: string;
    amount: number | null;
    docDate: string | null;
    dueDate: string | null;
    notes: string | null;
    projectId: string | null;
    projectName: string | null;
    projectCode: string | null;
    supplierName: string | null;
    itemCount: number;
    approvalRequestId: string | null;
    hasPendingApproval: boolean;
  };

  const items: OpenOrderItem[] = [
    ...prs.map((r) => ({
      id: r.id as string,
      type: 'pr' as const,
      number: r.number as string,
      status: r.status as string,
      amount: r.amount ? Number(r.amount) : null,
      docDate: r.doc_date as string | null,
      dueDate: r.required_date as string | null,
      notes: r.notes as string | null,
      projectId: r.project_id as string | null,
      projectName: r.project_name as string | null,
      projectCode: r.project_code as string | null,
      supplierName: null,
      itemCount: Number(r.item_count),
      approvalRequestId: r.approval_request_id as string | null,
      hasPendingApproval: !!r.approval_request_id,
    })),
    ...pos.map((r) => ({
      id: r.id as string,
      type: 'po' as const,
      number: r.number as string,
      status: r.status as string,
      amount: r.amount ? Number(r.amount) : null,
      docDate: r.doc_date as string | null,
      dueDate: r.expected_delivery_date as string | null,
      notes: r.notes as string | null,
      projectId: r.project_id as string | null,
      projectName: r.project_name as string | null,
      projectCode: r.project_code as string | null,
      supplierName: r.supplier_name as string | null,
      itemCount: Number(r.item_count),
      approvalRequestId: r.approval_request_id as string | null,
      hasPendingApproval: !!r.approval_request_id,
    })),
  ];

  // Sort by date descending
  items.sort((a, b) => {
    const dateA = a.docDate ? new Date(a.docDate).getTime() : 0;
    const dateB = b.docDate ? new Date(b.docDate).getTime() : 0;
    return dateB - dateA;
  });

  const summary = {
    totalPRs: prs.length,
    totalPOs: pos.length,
    total: items.length,
    pendingApproval: items.filter((i) => i.hasPendingApproval).length,
    totalValue: items.reduce((s, i) => s + (i.amount ?? 0), 0),
  };

  return apiResponse.success(res, { summary, items });
}));
