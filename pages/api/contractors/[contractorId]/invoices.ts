/**
 * Contractor Invoices API — List & Create
 *
 * GET  /api/contractors/[contractorId]/invoices
 *      — list invoices, optionally filtered by ?status=
 *
 * POST /api/contractors/[contractorId]/invoices
 *      — create a new invoice with line items and optionally bundle approved claims.
 *        Body: ContractorInvoiceFormData & { claimIds?: string[] }
 *        When claimIds are provided:
 *          1. Each claim is validated (belongs to contractor, status = 'approved')
 *          2. Invoice is created
 *          3. Each claim gets invoice_id set and status changed to 'invoiced'
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
  ContractorInvoiceWithDetails,
  ContractorInvoiceFormData,
  ContractorInvoiceStatus,
  InvoiceLineItem,
} from '@/types/contractor-invoice.types';
import { CONTRACTOR_INVOICE_STATUSES } from '@/types/contractor-invoice.types';

// ==================== Row type from DB ====================

interface InvoiceRow {
  id: string;
  contractor_id: string;
  contractor_project_id: string | null;
  invoice_number: string;
  status: ContractorInvoiceStatus;
  line_items: InvoiceLineItem[] | string;
  total_amount: string;
  rejection_reason: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  project_name: string | null;
  project_code: string | null;
  role: string | null;
}

// ==================== Mapper ====================

function mapRow(row: InvoiceRow): ContractorInvoiceWithDetails {
  const lineItems: InvoiceLineItem[] =
    typeof row.line_items === 'string'
      ? (JSON.parse(row.line_items) as InvoiceLineItem[])
      : row.line_items;

  return {
    id: row.id,
    contractorId: row.contractor_id,
    contractorProjectId: row.contractor_project_id
      ? Number(row.contractor_project_id)
      : null,
    invoiceNumber: row.invoice_number,
    status: row.status,
    lineItems,
    totalAmount: Number(row.total_amount),
    rejectionReason: row.rejection_reason,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    projectName: row.project_name,
    projectCode: row.project_code,
    role: row.role,
  };
}

// ==================== Handler ====================

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { contractorId } = req.query;

  if (!contractorId || typeof contractorId !== 'string') {
    return apiResponse.badRequest(res, 'Invalid contractor ID');
  }

  const [contractor] = await sql`
    SELECT id FROM contractors WHERE id = ${contractorId}
  `;
  if (!contractor) {
    return apiResponse.notFound(res, 'Contractor not found');
  }

  if (req.method === 'GET') return handleGet(req, res, contractorId);
  if (req.method === 'POST') return handlePost(req, res, contractorId);

  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
}

// ==================== GET ====================

async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  contractorId: string
) {
  try {
    const { status } = req.query;

    let rows: InvoiceRow[];

    if (status && typeof status === 'string') {
      if (!CONTRACTOR_INVOICE_STATUSES.includes(status as ContractorInvoiceStatus)) {
        return apiResponse.badRequest(res, `Invalid status filter: ${status}`);
      }
      rows = (await sql`
        SELECT
          ci.id, ci.contractor_id, ci.contractor_project_id,
          ci.invoice_number, ci.status, ci.line_items, ci.total_amount,
          ci.rejection_reason, ci.notes, ci.created_by, ci.created_at, ci.updated_at,
          p.project_name, p.project_code, cpj.role
        FROM contractor_invoices ci
        LEFT JOIN contractor_projects cpj ON ci.contractor_project_id = cpj.id
        LEFT JOIN projects p ON cpj.project_id = p.id
        WHERE ci.contractor_id = ${contractorId}
          AND ci.status = ${status as ContractorInvoiceStatus}
        ORDER BY ci.created_at DESC
      `) as unknown as InvoiceRow[];
    } else {
      rows = (await sql`
        SELECT
          ci.id, ci.contractor_id, ci.contractor_project_id,
          ci.invoice_number, ci.status, ci.line_items, ci.total_amount,
          ci.rejection_reason, ci.notes, ci.created_by, ci.created_at, ci.updated_at,
          p.project_name, p.project_code, cpj.role
        FROM contractor_invoices ci
        LEFT JOIN contractor_projects cpj ON ci.contractor_project_id = cpj.id
        LEFT JOIN projects p ON cpj.project_id = p.id
        WHERE ci.contractor_id = ${contractorId}
        ORDER BY ci.created_at DESC
      `) as unknown as InvoiceRow[];
    }

    const invoices = rows.map(mapRow);
    return res.status(200).json({ data: invoices });
  } catch (error) {
    log.error('Error fetching contractor invoices', { error, contractorId });
    return apiResponse.internalError(res, new Error('Failed to fetch invoices'));
  }
}

// ==================== POST ====================

interface CreateInvoiceBody extends ContractorInvoiceFormData {
  claimIds?: string[];
}

async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  contractorId: string
) {
  try {
    const body = req.body as CreateInvoiceBody;

    if (!body.invoiceNumber || typeof body.invoiceNumber !== 'string' || !body.invoiceNumber.trim()) {
      return apiResponse.badRequest(res, 'invoiceNumber is required');
    }

    if (!Array.isArray(body.lineItems) || body.lineItems.length === 0) {
      return apiResponse.badRequest(res, 'lineItems must be a non-empty array');
    }

    for (const item of body.lineItems) {
      if (!item.description || typeof item.quantity !== 'number' || typeof item.unit_price !== 'number' || typeof item.amount !== 'number') {
        return apiResponse.badRequest(res, 'Each line item must have description, quantity, unit_price, and amount');
      }
    }

    const computedTotal = parseFloat(
      body.lineItems.reduce((sum, item) => sum + item.amount, 0).toFixed(2)
    );

    // Validate optional claim bundling
    const claimIds: string[] = Array.isArray(body.claimIds) ? body.claimIds : [];
    if (claimIds.length > 0) {
      const claimRows = (await sql`
        SELECT id, status, contractor_id
        FROM contractor_progress_claims
        WHERE id = ANY(${claimIds}::uuid[])
      `) as unknown as Array<{ id: string; status: string; contractor_id: string }>;

      // All claim IDs must exist
      if (claimRows.length !== claimIds.length) {
        return apiResponse.badRequest(res, 'One or more claimIds do not exist');
      }

      // All claims must belong to this contractor
      const wrongContractor = claimRows.find((c) => c.contractor_id !== contractorId);
      if (wrongContractor) {
        return apiResponse.badRequest(res, `Claim ${wrongContractor.id} does not belong to this contractor`);
      }

      // All claims must be in 'approved' status
      const notApproved = claimRows.find((c) => c.status !== 'approved');
      if (notApproved) {
        return apiResponse.badRequest(
          res,
          `Claim ${notApproved.id} is '${notApproved.status}' — only approved claims can be bundled into an invoice`
        );
      }
    }

    if (body.contractorProjectId !== undefined && body.contractorProjectId !== null) {
      const [proj] = await sql`
        SELECT id FROM contractor_projects
        WHERE id = ${body.contractorProjectId} AND contractor_id = ${contractorId}
      `;
      if (!proj) {
        return apiResponse.badRequest(res, 'contractorProjectId does not exist or does not belong to this contractor');
      }
    }

    const authReq = req as AuthenticatedNextApiRequest;
    if (!authReq.user?.id) {
      return apiResponse.unauthorized(res);
    }

    const contractorProjectId = body.contractorProjectId ?? null;
    const notes = body.notes ?? null;
    const createdBy = authReq.user.id;
    const lineItemsJson = JSON.stringify(body.lineItems);

    let insertedId: string;
    try {
      const insertedRows = (await sql`
        INSERT INTO contractor_invoices
          (contractor_id, contractor_project_id, invoice_number, status,
           line_items, total_amount, notes, created_by)
        VALUES
          (${contractorId}, ${contractorProjectId}, ${body.invoiceNumber.trim()},
           'submitted', ${lineItemsJson}::jsonb, ${computedTotal}, ${notes}, ${createdBy})
        RETURNING id
      `) as unknown as Array<{ id: string }>;

      const first = insertedRows[0];
      if (!first?.id) {
        return apiResponse.internalError(res, new Error('Insert returned no rows'));
      }
      insertedId = first.id;
    } catch (dbError: unknown) {
      const msg = dbError instanceof Error ? dbError.message : '';
      if (msg.includes('uq_contractor_invoice_number')) {
        return apiResponse.badRequest(res, `Invoice number '${body.invoiceNumber}' already exists for this contractor`);
      }
      throw dbError;
    }

    // Bundle claims: link them to the new invoice and transition to 'invoiced'
    if (claimIds.length > 0) {
      await sql`
        UPDATE contractor_progress_claims
        SET invoice_id = ${insertedId}::uuid,
            status     = 'invoiced',
            updated_at = NOW()
        WHERE id = ANY(${claimIds}::uuid[])
          AND contractor_id = ${contractorId}
          AND status = 'approved'
      `;
      log.info('Bundled claims into invoice', { invoiceId: insertedId, claimIds, contractorId }, 'invoices.POST');
    }

    const fullRows = (await sql`
      SELECT
        ci.id, ci.contractor_id, ci.contractor_project_id,
        ci.invoice_number, ci.status, ci.line_items, ci.total_amount,
        ci.rejection_reason, ci.notes, ci.created_by, ci.created_at, ci.updated_at,
        p.project_name, p.project_code, cpj.role
      FROM contractor_invoices ci
      LEFT JOIN contractor_projects cpj ON ci.contractor_project_id = cpj.id
      LEFT JOIN projects p ON cpj.project_id = p.id
      WHERE ci.id = ${insertedId}
    `) as unknown as InvoiceRow[];

    const full = fullRows[0];
    if (!full) {
      return apiResponse.internalError(res, new Error('Could not retrieve inserted invoice'));
    }

    return res.status(201).json({ data: mapRow(full) });
  } catch (error) {
    log.error('Error creating contractor invoice', { error, contractorId });
    return apiResponse.internalError(res, new Error('Failed to create invoice'));
  }
}

export default withAuth(handler);
