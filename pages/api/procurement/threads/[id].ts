/**
 * GET /api/procurement/threads/[id] — Fetch a single procurement thread with linked document details
 * PUT /api/procurement/threads/[id] — Update a procurement thread (COALESCE for partial updates)
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';

const sql = neon(process.env.DATABASE_URL!);

// ── Types ──────────────────────────────────────────────────────────────────

type ProcurementThread = {
  id: string;
  threadNumber: string;
  title: string | null;
  projectId: string | null;
  projectName: string | null;
  projectCode: string | null;
  requisitionId: string | null;
  requisitionNumber: string | null;
  rfqId: string | null;
  quoteId: string | null;
  poId: string | null;
  poNumber: string | null;
  poTotal: number | null;
  grnId: string | null;
  paymentApprovalId: string | null;
  strategy: string | null;
  currentStep: string | null;
  status: string;
  estimatedTotal: number | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type PutBody = {
  currentStep?: string;
  status?: string;
  requisitionId?: string;
  rfqId?: string;
  quoteId?: string;
  poId?: string;
  grnId?: string;
  paymentApprovalId?: string;
  strategy?: string;
  estimatedTotal?: number;
  poTotal?: number;
  title?: string;
};

// ── Handler ────────────────────────────────────────────────────────────────

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Thread ID is required');
  }

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT
        t.id,
        t.thread_number,
        t.title,
        t.project_id,
        p.project_name,
        p.project_code,
        t.requisition_id,
        pr.requisition_number,
        t.rfq_id,
        t.quote_id,
        t.po_id,
        po.po_number,
        po.total_amount           AS po_total,
        t.grn_id,
        t.payment_approval_id,
        t.strategy,
        t.current_step,
        t.status,
        t.estimated_total,
        t.created_by,
        t.created_at,
        t.updated_at
      FROM procurement_threads t
      LEFT JOIN projects p
        ON t.project_id = p.id
      LEFT JOIN purchase_requisitions pr
        ON t.requisition_id = pr.id
      LEFT JOIN purchase_orders po
        ON t.po_id = po.id
      WHERE t.id = ${id}
    `;

    if (rows.length === 0) {
      return apiResponse.notFound(res, 'Procurement thread', id);
    }

    const r = rows[0]!;

    const thread: ProcurementThread = {
      id: r.id as string,
      threadNumber: r.thread_number as string,
      title: r.title as string | null,
      projectId: r.project_id as string | null,
      projectName: r.project_name as string | null,
      projectCode: r.project_code as string | null,
      requisitionId: r.requisition_id as string | null,
      requisitionNumber: r.requisition_number as string | null,
      rfqId: r.rfq_id as string | null,
      quoteId: r.quote_id as string | null,
      poId: r.po_id as string | null,
      poNumber: r.po_number as string | null,
      poTotal: r.po_total ? Number(r.po_total) : null,
      grnId: r.grn_id as string | null,
      paymentApprovalId: r.payment_approval_id as string | null,
      strategy: r.strategy as string | null,
      currentStep: r.current_step as string | null,
      status: r.status as string,
      estimatedTotal: r.estimated_total ? Number(r.estimated_total) : null,
      createdBy: r.created_by as string | null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };

    return apiResponse.success(res, thread);
  }

  if (req.method === 'PUT') {
    const body = req.body as PutBody;

    // Verify thread exists before updating
    const existing = await sql`
      SELECT id FROM procurement_threads WHERE id = ${id}
    `;

    if (existing.length === 0) {
      return apiResponse.notFound(res, 'Procurement thread', id);
    }

    const updated = await sql`
      UPDATE procurement_threads
      SET
        title               = COALESCE(${body.title ?? null}, title),
        current_step        = COALESCE(${body.currentStep ?? null}, current_step),
        status              = COALESCE(${body.status ?? null}, status),
        requisition_id      = COALESCE(${body.requisitionId ?? null}, requisition_id),
        rfq_id              = COALESCE(${body.rfqId ?? null}, rfq_id),
        quote_id            = COALESCE(${body.quoteId ?? null}, quote_id),
        po_id               = COALESCE(${body.poId ?? null}, po_id),
        grn_id              = COALESCE(${body.grnId ?? null}, grn_id),
        payment_approval_id = COALESCE(${body.paymentApprovalId ?? null}, payment_approval_id),
        strategy            = COALESCE(${body.strategy ?? null}, strategy),
        estimated_total     = COALESCE(${body.estimatedTotal ?? null}, estimated_total),
        po_total            = COALESCE(${body.poTotal ?? null}, po_total),
        updated_at          = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    log.info('Procurement thread updated', { id, fields: Object.keys(body) }, 'procurement-threads');

    return apiResponse.success(res, updated[0], 'Procurement thread updated');
  }

  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'PUT']);
}));
