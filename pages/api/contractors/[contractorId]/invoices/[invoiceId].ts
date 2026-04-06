/**
 * Contractor Invoice Detail API
 *
 * GET /api/contractors/[contractorId]/invoices/[invoiceId]
 *     — fetch single invoice with full details
 *
 * Protected by auth middleware.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type {
  ContractorInvoiceWithDetails,
  ContractorInvoiceStatus,
  InvoiceLineItem,
} from '@/types/contractor-invoice.types';

// ==================== Row type ====================

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
  const { contractorId, invoiceId } = req.query;

  if (!contractorId || typeof contractorId !== 'string') {
    return apiResponse.badRequest(res, 'Invalid contractor ID');
  }
  if (!invoiceId || typeof invoiceId !== 'string') {
    return apiResponse.badRequest(res, 'Invalid invoice ID');
  }

  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    const rows = (await sql`
      SELECT
        ci.id, ci.contractor_id, ci.contractor_project_id,
        ci.invoice_number, ci.status, ci.line_items, ci.total_amount,
        ci.rejection_reason, ci.notes, ci.created_by, ci.created_at, ci.updated_at,
        p.project_name, p.project_code, cpj.role
      FROM contractor_invoices ci
      LEFT JOIN contractor_projects cpj ON ci.contractor_project_id = cpj.id
      LEFT JOIN projects p ON cpj.project_id = p.id
      WHERE ci.id = ${invoiceId}
        AND ci.contractor_id = ${contractorId}
    `) as unknown as InvoiceRow[];

    const row = rows[0];
    if (!row) {
      return apiResponse.notFound(res, 'Invoice not found');
    }

    return res.status(200).json({ data: mapRow(row) });
  } catch (error) {
    log.error('Error fetching contractor invoice detail', { error, contractorId, invoiceId });
    return apiResponse.internalError(res, new Error('Failed to fetch invoice'));
  }
}

export default withAuth(handler);
