/**
 * Contractor Progress Claims API — List & Submit
 *
 * GET  /api/contractors/[contractorId]/claims
 *      — list all progress claims; optional ?status= filter
 *
 * POST /api/contractors/[contractorId]/claims
 *      — submit a new progress claim
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
  ContractorProgressClaimWithDetails,
  ContractorProgressClaimFormData,
  ContractorClaimStatus,
} from '@/types/contractor-progress-claim.types';
import { CONTRACTOR_CLAIM_STATUSES } from '@/types/contractor-progress-claim.types';

// ==================== Row type from DB ====================

interface ClaimRow {
  id: string;
  contractor_id: string;
  contractor_project_id: string | null;
  claim_number: string;
  claim_date: string;
  period_start: string;
  period_end: string;
  description: string;
  amount_claimed: string;
  amount_approved: string | null;
  status: ContractorClaimStatus;
  submitted_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  invoice_id: string | null;
  created_at: string;
  updated_at: string;
  project_name: string | null;
  project_code: string | null;
  role: string | null;
}

// ==================== Mapper ====================

function mapRow(row: ClaimRow): ContractorProgressClaimWithDetails {
  return {
    id: row.id,
    contractorId: row.contractor_id,
    contractorProjectId: row.contractor_project_id ? Number(row.contractor_project_id) : null,
    claimNumber: Number(row.claim_number),
    claimDate: new Date(row.claim_date),
    periodStart: new Date(row.period_start),
    periodEnd: new Date(row.period_end),
    description: row.description,
    amountClaimed: Number(row.amount_claimed),
    amountApproved: row.amount_approved !== null ? Number(row.amount_approved) : null,
    status: row.status,
    submittedBy: row.submitted_by,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
    reviewNotes: row.review_notes,
    invoiceId: row.invoice_id,
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

    let rows: ClaimRow[];

    if (status && typeof status === 'string') {
      if (!CONTRACTOR_CLAIM_STATUSES.includes(status as ContractorClaimStatus)) {
        return apiResponse.badRequest(res, `Invalid status filter: ${status}`);
      }
      rows = (await sql`
        SELECT
          cpc.id, cpc.contractor_id, cpc.contractor_project_id,
          cpc.claim_number, cpc.claim_date, cpc.period_start, cpc.period_end,
          cpc.description, cpc.amount_claimed, cpc.amount_approved, cpc.status,
          cpc.submitted_by, cpc.reviewed_by, cpc.reviewed_at, cpc.review_notes,
          cpc.invoice_id, cpc.created_at, cpc.updated_at,
          p.project_name, p.project_code, cpj.role
        FROM contractor_progress_claims cpc
        LEFT JOIN contractor_projects cpj ON cpc.contractor_project_id = cpj.id
        LEFT JOIN projects p ON cpj.project_id = p.id
        WHERE cpc.contractor_id = ${contractorId}
          AND cpc.status = ${status as ContractorClaimStatus}
        ORDER BY cpc.claim_number DESC
      `) as unknown as ClaimRow[];
    } else {
      rows = (await sql`
        SELECT
          cpc.id, cpc.contractor_id, cpc.contractor_project_id,
          cpc.claim_number, cpc.claim_date, cpc.period_start, cpc.period_end,
          cpc.description, cpc.amount_claimed, cpc.amount_approved, cpc.status,
          cpc.submitted_by, cpc.reviewed_by, cpc.reviewed_at, cpc.review_notes,
          cpc.invoice_id, cpc.created_at, cpc.updated_at,
          p.project_name, p.project_code, cpj.role
        FROM contractor_progress_claims cpc
        LEFT JOIN contractor_projects cpj ON cpc.contractor_project_id = cpj.id
        LEFT JOIN projects p ON cpj.project_id = p.id
        WHERE cpc.contractor_id = ${contractorId}
        ORDER BY cpc.claim_number DESC
      `) as unknown as ClaimRow[];
    }

    const claims = rows.map(mapRow);

    const summary = {
      totalClaimed: claims.reduce((s, c) => s + c.amountClaimed, 0),
      totalApproved: claims.filter(c => c.amountApproved !== null).reduce((s, c) => s + (c.amountApproved ?? 0), 0),
      pendingCount: claims.filter(c => c.status === 'pending').length,
      approvedCount: claims.filter(c => c.status === 'approved').length,
      rejectedCount: claims.filter(c => c.status === 'rejected').length,
      invoicedCount: claims.filter(c => c.status === 'invoiced').length,
    };

    return res.status(200).json({ data: claims, summary });
  } catch (error) {
    log.error('Error fetching contractor progress claims', { error, contractorId });
    return apiResponse.internalError(res, new Error('Failed to fetch progress claims'));
  }
}

// ==================== POST ====================

async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  contractorId: string
) {
  try {
    const body = req.body as ContractorProgressClaimFormData;

    if (!body.claimDate || !body.periodStart || !body.periodEnd) {
      return apiResponse.badRequest(res, 'claimDate, periodStart, and periodEnd are required');
    }

    if (!body.description || !body.description.trim()) {
      return apiResponse.badRequest(res, 'description is required');
    }

    if (typeof body.amountClaimed !== 'number' || body.amountClaimed <= 0) {
      return apiResponse.badRequest(res, 'amountClaimed must be a positive number');
    }

    if (new Date(body.periodStart) > new Date(body.periodEnd)) {
      return apiResponse.badRequest(res, 'periodStart must be before or equal to periodEnd');
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

    // Auto-assign next claim number for this contractor
    const [countRow] = await sql`
      SELECT COALESCE(MAX(claim_number), 0) + 1 AS next_number
      FROM contractor_progress_claims
      WHERE contractor_id = ${contractorId}
    ` as unknown as Array<{ next_number: string }>;
    const nextClaimNumber = Number(countRow?.next_number ?? 1);

    const contractorProjectId = body.contractorProjectId ?? null;
    const submittedBy = authReq.user.id;

    const [insertedRow] = await sql`
      INSERT INTO contractor_progress_claims
        (contractor_id, contractor_project_id, claim_number, claim_date,
         period_start, period_end, description, amount_claimed, submitted_by)
      VALUES
        (${contractorId}, ${contractorProjectId}, ${nextClaimNumber},
         ${body.claimDate}, ${body.periodStart}, ${body.periodEnd},
         ${body.description.trim()}, ${body.amountClaimed}, ${submittedBy})
      RETURNING id
    ` as unknown as Array<{ id: string }>;

    if (!insertedRow?.id) {
      return apiResponse.internalError(res, new Error('Insert returned no rows'));
    }

    const fullRows = (await sql`
      SELECT
        cpc.id, cpc.contractor_id, cpc.contractor_project_id,
        cpc.claim_number, cpc.claim_date, cpc.period_start, cpc.period_end,
        cpc.description, cpc.amount_claimed, cpc.amount_approved, cpc.status,
        cpc.submitted_by, cpc.reviewed_by, cpc.reviewed_at, cpc.review_notes,
        cpc.invoice_id, cpc.created_at, cpc.updated_at,
        p.project_name, p.project_code, cpj.role
      FROM contractor_progress_claims cpc
      LEFT JOIN contractor_projects cpj ON cpc.contractor_project_id = cpj.id
      LEFT JOIN projects p ON cpj.project_id = p.id
      WHERE cpc.id = ${insertedRow.id}
    `) as unknown as ClaimRow[];

    if (!fullRows[0]) {
      return apiResponse.internalError(res, new Error('Could not retrieve inserted claim'));
    }

    log.info('Progress claim submitted', {
      claimId: insertedRow.id,
      contractorId,
      claimNumber: nextClaimNumber,
    });

    return res.status(201).json({ data: mapRow(fullRows[0]) });
  } catch (error) {
    log.error('Error creating contractor progress claim', { error, contractorId });
    return apiResponse.internalError(res, new Error('Failed to submit progress claim'));
  }
}

export default withAuth(handler);
