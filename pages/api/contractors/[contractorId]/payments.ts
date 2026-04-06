/**
 * Contractor Payments API
 *
 * GET  /api/contractors/[contractorId]/payments
 *      — list payments for a contractor (filterable by date range)
 *      — append ?export=csv to download as CSV
 *
 * POST /api/contractors/[contractorId]/payments
 *      — record a new payment
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
  ContractorPaymentWithDetails,
  ContractorPaymentFormData,
  ContractorPaymentSummary,
} from '@/types/contractor-payment.types';

// ==================== Row type from DB ====================

interface PaymentRow {
  id: string;
  contractor_id: string;
  contractor_project_id: string | null;
  amount: string;
  payment_date: string;
  reference: string | null;
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
  project_name: string | null;
  project_code: string | null;
  role: string | null;
}

// ==================== Mapper ====================

function mapRowToPayment(row: PaymentRow): ContractorPaymentWithDetails {
  return {
    id: row.id,
    contractorId: row.contractor_id,
    contractorProjectId: row.contractor_project_id ? Number(row.contractor_project_id) : null,
    amount: Number(row.amount),
    paymentDate: new Date(row.payment_date),
    reference: row.reference,
    notes: row.notes,
    recordedBy: row.recorded_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    projectName: row.project_name,
    projectCode: row.project_code,
    role: row.role,
  };
}

// ==================== CSV builder ====================

function buildCsv(payments: ContractorPaymentWithDetails[]): string {
  const headers = [
    'ID',
    'Payment Date',
    'Amount (ZAR)',
    'Reference',
    'Project',
    'Role',
    'Notes',
    'Recorded At',
  ].join(',');

  const rows = payments.map((p) => {
    const escape = (v: string | null | undefined) =>
      v ? `"${String(v).replace(/"/g, '""')}"` : '';

    return [
      p.id,
      p.paymentDate.toISOString().split('T')[0],
      p.amount.toFixed(2),
      escape(p.reference),
      escape(p.projectName ? `${p.projectName} (${p.projectCode})` : null),
      escape(p.role),
      escape(p.notes),
      p.createdAt.toISOString(),
    ].join(',');
  });

  return [headers, ...rows].join('\n');
}

// ==================== Handler ====================

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { contractorId } = req.query;

  if (!contractorId || typeof contractorId !== 'string') {
    return apiResponse.badRequest(res, 'Invalid contractor ID');
  }

  // Verify contractor exists
  const [contractor] = await sql`
    SELECT id FROM contractors WHERE id = ${contractorId}
  `;
  if (!contractor) {
    return apiResponse.notFound(res, 'Contractor not found');
  }

  if (req.method === 'GET') {
    return handleGet(req, res, contractorId);
  }

  if (req.method === 'POST') {
    return handlePost(req, res, contractorId);
  }

  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
}

// ==================== GET ====================

async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  contractorId: string
) {
  try {
    const { fromDate, toDate, export: exportParam } = req.query;

    // Fetch with optional date range — Neon requires static query shapes, so branch explicitly.
    // Cast via unknown since PaymentRow uses concrete types (string|null) vs SqlRow's (unknown).
    let rows: PaymentRow[];

    if (fromDate && toDate) {
      rows = (await sql`
        SELECT
          cp.id, cp.contractor_id, cp.contractor_project_id,
          cp.amount, cp.payment_date, cp.reference, cp.notes,
          cp.recorded_by, cp.created_at, cp.updated_at,
          p.project_name, p.project_code, cpj.role
        FROM contractor_payments cp
        LEFT JOIN contractor_projects cpj ON cp.contractor_project_id = cpj.id
        LEFT JOIN projects p ON cpj.project_id = p.id
        WHERE cp.contractor_id = ${contractorId}
          AND cp.payment_date >= ${fromDate as string}
          AND cp.payment_date <= ${toDate as string}
        ORDER BY cp.payment_date DESC, cp.created_at DESC
      `) as unknown as PaymentRow[];
    } else if (fromDate) {
      rows = (await sql`
        SELECT
          cp.id, cp.contractor_id, cp.contractor_project_id,
          cp.amount, cp.payment_date, cp.reference, cp.notes,
          cp.recorded_by, cp.created_at, cp.updated_at,
          p.project_name, p.project_code, cpj.role
        FROM contractor_payments cp
        LEFT JOIN contractor_projects cpj ON cp.contractor_project_id = cpj.id
        LEFT JOIN projects p ON cpj.project_id = p.id
        WHERE cp.contractor_id = ${contractorId}
          AND cp.payment_date >= ${fromDate as string}
        ORDER BY cp.payment_date DESC, cp.created_at DESC
      `) as unknown as PaymentRow[];
    } else if (toDate) {
      rows = (await sql`
        SELECT
          cp.id, cp.contractor_id, cp.contractor_project_id,
          cp.amount, cp.payment_date, cp.reference, cp.notes,
          cp.recorded_by, cp.created_at, cp.updated_at,
          p.project_name, p.project_code, cpj.role
        FROM contractor_payments cp
        LEFT JOIN contractor_projects cpj ON cp.contractor_project_id = cpj.id
        LEFT JOIN projects p ON cpj.project_id = p.id
        WHERE cp.contractor_id = ${contractorId}
          AND cp.payment_date <= ${toDate as string}
        ORDER BY cp.payment_date DESC, cp.created_at DESC
      `) as unknown as PaymentRow[];
    } else {
      rows = (await sql`
        SELECT
          cp.id, cp.contractor_id, cp.contractor_project_id,
          cp.amount, cp.payment_date, cp.reference, cp.notes,
          cp.recorded_by, cp.created_at, cp.updated_at,
          p.project_name, p.project_code, cpj.role
        FROM contractor_payments cp
        LEFT JOIN contractor_projects cpj ON cp.contractor_project_id = cpj.id
        LEFT JOIN projects p ON cpj.project_id = p.id
        WHERE cp.contractor_id = ${contractorId}
        ORDER BY cp.payment_date DESC, cp.created_at DESC
      `) as unknown as PaymentRow[];
    }

    const payments = rows.map(mapRowToPayment);

    // CSV export
    if (exportParam === 'csv') {
      const csv = buildCsv(payments);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="contractor-payments-${contractorId}-${new Date().toISOString().split('T')[0]}.csv"`
      );
      return res.status(200).send(csv);
    }

    // Compute summary
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    const summary: ContractorPaymentSummary = {
      totalPaid,
      paymentCount: payments.length,
      lastPaymentDate: payments.length > 0 ? payments[0]!.paymentDate : null,
    };

    return res.status(200).json({ data: payments, summary });
  } catch (error) {
    log.error('Error fetching contractor payments', { error, contractorId });
    return apiResponse.internalError(res, new Error('Failed to fetch payments'));
  }
}

// ==================== POST ====================

async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  contractorId: string
) {
  try {
    const body = req.body as ContractorPaymentFormData;

    // Validate required fields
    if (!body.amount || typeof body.amount !== 'number' || body.amount <= 0) {
      return apiResponse.badRequest(res, 'amount must be a positive number');
    }
    if (!body.paymentDate || typeof body.paymentDate !== 'string') {
      return apiResponse.badRequest(res, 'paymentDate is required (YYYY-MM-DD)');
    }

    // Validate contractor_project_id if provided
    if (body.contractorProjectId !== undefined && body.contractorProjectId !== null) {
      const [proj] = await sql`
        SELECT id FROM contractor_projects
        WHERE id = ${body.contractorProjectId} AND contractor_id = ${contractorId}
      `;
      if (!proj) {
        return apiResponse.badRequest(
          res,
          'contractorProjectId does not exist or does not belong to this contractor'
        );
      }
    }

    const contractorProjectId = body.contractorProjectId ?? null;
    const reference = body.reference ?? null;
    const notes = body.notes ?? null;
    const recordedBy = (req as AuthenticatedNextApiRequest).user.id;

    const insertedRows = (await sql`
      INSERT INTO contractor_payments
        (contractor_id, contractor_project_id, amount, payment_date, reference, notes, recorded_by)
      VALUES
        (${contractorId}, ${contractorProjectId}, ${body.amount}, ${body.paymentDate},
         ${reference}, ${notes}, ${recordedBy})
      RETURNING id
    `) as unknown as Array<{ id: string }>;

    const insertedId = insertedRows[0]?.id;
    if (!insertedId) {
      return apiResponse.internalError(res, new Error('Insert returned no rows'));
    }

    // Re-fetch with joins for full response
    const fullRows = (await sql`
      SELECT
        cp.id, cp.contractor_id, cp.contractor_project_id,
        cp.amount, cp.payment_date, cp.reference, cp.notes,
        cp.recorded_by, cp.created_at, cp.updated_at,
        p.project_name, p.project_code, cpj.role
      FROM contractor_payments cp
      LEFT JOIN contractor_projects cpj ON cp.contractor_project_id = cpj.id
      LEFT JOIN projects p ON cpj.project_id = p.id
      WHERE cp.id = ${insertedId}
    `) as unknown as PaymentRow[];

    const full = fullRows[0];
    if (!full) {
      return apiResponse.internalError(res, new Error('Could not retrieve inserted payment'));
    }

    return res.status(201).json({ data: mapRowToPayment(full) });
  } catch (error) {
    log.error('Error recording contractor payment', { error, contractorId });
    return apiResponse.internalError(res, new Error('Failed to record payment'));
  }
}

export default withAuth(handler);
