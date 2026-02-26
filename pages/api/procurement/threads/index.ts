/**
 * GET  /api/procurement/threads  — List procurement threads with optional filters
 * POST /api/procurement/threads  — Create a new procurement thread
 *
 * Query params (GET):
 *   status?    — filter by thread status ('active' | 'completed' | 'on_hold' | 'cancelled')
 *   projectId? — filter to a specific project
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';

const sql = neon(process.env.DATABASE_URL!);

// ── Shared SELECT columns (repeated per branch — no conditional fragments) ─

// ── Query branches ─────────────────────────────────────────────────────────

// Returns rows typed as unknown[] so callers can cast. Neon returns Record<string,any>[].
async function fetchThreadsBothFilters(status: string, projectId: string) {
  return sql`
    SELECT
      t.id,
      t.thread_number,
      t.title,
      t.project_id,
      p.project_name,
      p.project_code,
      t.requisition_id,
      pr.requisition_number,
      t.po_id,
      po.po_number,
      t.rfq_id,
      t.quote_id,
      t.grn_id,
      t.payment_approval_id,
      t.strategy,
      t.current_step,
      t.status,
      t.estimated_total,
      t.po_total,
      t.created_by,
      t.created_at,
      t.updated_at
    FROM procurement_threads t
    LEFT JOIN projects p ON t.project_id = p.id
    LEFT JOIN purchase_requisitions pr ON t.requisition_id = pr.id
    LEFT JOIN purchase_orders po ON t.po_id = po.id
    WHERE t.status = ${status}
      AND t.project_id = ${projectId}
    ORDER BY
      CASE WHEN t.status = 'active' THEN 0 ELSE 1 END,
      t.updated_at DESC
  `;
}

async function fetchThreadsByStatus(status: string) {
  return sql`
    SELECT
      t.id,
      t.thread_number,
      t.title,
      t.project_id,
      p.project_name,
      p.project_code,
      t.requisition_id,
      pr.requisition_number,
      t.po_id,
      po.po_number,
      t.rfq_id,
      t.quote_id,
      t.grn_id,
      t.payment_approval_id,
      t.strategy,
      t.current_step,
      t.status,
      t.estimated_total,
      t.po_total,
      t.created_by,
      t.created_at,
      t.updated_at
    FROM procurement_threads t
    LEFT JOIN projects p ON t.project_id = p.id
    LEFT JOIN purchase_requisitions pr ON t.requisition_id = pr.id
    LEFT JOIN purchase_orders po ON t.po_id = po.id
    WHERE t.status = ${status}
    ORDER BY
      CASE WHEN t.status = 'active' THEN 0 ELSE 1 END,
      t.updated_at DESC
  `;
}

async function fetchThreadsByProject(projectId: string) {
  return sql`
    SELECT
      t.id,
      t.thread_number,
      t.title,
      t.project_id,
      p.project_name,
      p.project_code,
      t.requisition_id,
      pr.requisition_number,
      t.po_id,
      po.po_number,
      t.rfq_id,
      t.quote_id,
      t.grn_id,
      t.payment_approval_id,
      t.strategy,
      t.current_step,
      t.status,
      t.estimated_total,
      t.po_total,
      t.created_by,
      t.created_at,
      t.updated_at
    FROM procurement_threads t
    LEFT JOIN projects p ON t.project_id = p.id
    LEFT JOIN purchase_requisitions pr ON t.requisition_id = pr.id
    LEFT JOIN purchase_orders po ON t.po_id = po.id
    WHERE t.project_id = ${projectId}
    ORDER BY
      CASE WHEN t.status = 'active' THEN 0 ELSE 1 END,
      t.updated_at DESC
  `;
}

async function fetchAllThreads() {
  return sql`
    SELECT
      t.id,
      t.thread_number,
      t.title,
      t.project_id,
      p.project_name,
      p.project_code,
      t.requisition_id,
      pr.requisition_number,
      t.po_id,
      po.po_number,
      t.rfq_id,
      t.quote_id,
      t.grn_id,
      t.payment_approval_id,
      t.strategy,
      t.current_step,
      t.status,
      t.estimated_total,
      t.po_total,
      t.created_by,
      t.created_at,
      t.updated_at
    FROM procurement_threads t
    LEFT JOIN projects p ON t.project_id = p.id
    LEFT JOIN purchase_requisitions pr ON t.requisition_id = pr.id
    LEFT JOIN purchase_orders po ON t.po_id = po.id
    ORDER BY
      CASE WHEN t.status = 'active' THEN 0 ELSE 1 END,
      t.updated_at DESC
  `;
}

// ── Handler ────────────────────────────────────────────────────────────────

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    const { status, projectId } = req.query;
    const statusStr = typeof status === 'string' ? status : undefined;
    const projectIdStr = typeof projectId === 'string' ? projectId : undefined;

    // Explicit query branch for each filter combination (no conditional SQL fragments)
    const rows = statusStr && projectIdStr
      ? await fetchThreadsBothFilters(statusStr, projectIdStr)
      : statusStr
        ? await fetchThreadsByStatus(statusStr)
        : projectIdStr
          ? await fetchThreadsByProject(projectIdStr)
          : await fetchAllThreads();

    const threads = rows.map((r: Record<string, unknown>) => ({
      id: r['id'] as string,
      threadNumber: r['thread_number'] as string,
      title: r['title'] as string | null,
      projectId: r['project_id'] as string | null,
      projectName: r['project_name'] as string | null,
      projectCode: r['project_code'] as string | null,
      requisitionId: r['requisition_id'] as string | null,
      requisitionNumber: r['requisition_number'] as string | null,
      poId: r['po_id'] as string | null,
      poNumber: r['po_number'] as string | null,
      rfqId: r['rfq_id'] as string | null,
      quoteId: r['quote_id'] as string | null,
      grnId: r['grn_id'] as string | null,
      paymentApprovalId: r['payment_approval_id'] as string | null,
      strategy: r['strategy'] as string | null,
      currentStep: r['current_step'] as string | null,
      status: r['status'] as string,
      estimatedTotal: r['estimated_total'] ? Number(r['estimated_total']) : null,
      poTotal: r['po_total'] ? Number(r['po_total']) : null,
      createdBy: r['created_by'] as string | null,
      createdAt: r['created_at'] as string,
      updatedAt: r['updated_at'] as string,
    }));

    const active = threads.filter((t) => t.status === 'active').length;
    const completed = threads.filter((t) => t.status === 'completed').length;
    const totalValue = threads.reduce(
      (sum, t) => sum + (t.poTotal ?? t.estimatedTotal ?? 0),
      0
    );

    return apiResponse.success(res, {
      threads,
      summary: { total: threads.length, active, completed, totalValue },
    });
  }

  if (req.method === 'POST') {
    const {
      projectId,
      title,
      requisitionId,
      strategy,
      estimatedTotal,
      createdBy,
    } = req.body as {
      projectId?: string;
      title?: string;
      requisitionId?: string;
      strategy?: string;
      estimatedTotal?: number;
      createdBy?: string;
    };

    if (!createdBy) {
      return apiResponse.badRequest(res, 'createdBy is required');
    }

    const [created] = await sql`
      INSERT INTO procurement_threads (
        project_id,
        title,
        requisition_id,
        strategy,
        estimated_total,
        created_by,
        status,
        current_step
      ) VALUES (
        ${projectId ?? null},
        ${title ?? null},
        ${requisitionId ?? null},
        ${strategy ?? null},
        ${estimatedTotal ?? null},
        ${createdBy},
        'active',
        1
      )
      RETURNING *
    `;

    log.info('Procurement thread created', { id: (created as Record<string, unknown>)['id'], createdBy }, 'procurement-threads');

    return apiResponse.created(res, created, 'Procurement thread created');
  }

  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
}));
