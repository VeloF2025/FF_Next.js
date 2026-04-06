/**
 * Contractor Progress Claim Detail API — Review (Approve/Reject)
 *
 * PATCH /api/contractors/[contractorId]/claims/[claimId]
 *       Body: { action: 'approve', amountApproved: number, reviewNotes?: string }
 *             { action: 'reject', reviewNotes: string }
 *
 * Status transitions:
 *   pending → approved (amountApproved required)
 *   pending → rejected (reviewNotes required)
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
  ContractorClaimStatus,
  ContractorClaimReviewPayload,
} from '@/types/contractor-progress-claim.types';

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
  const { contractorId, claimId } = req.query;

  if (!contractorId || typeof contractorId !== 'string') {
    return apiResponse.badRequest(res, 'Invalid contractor ID');
  }
  if (!claimId || typeof claimId !== 'string') {
    return apiResponse.badRequest(res, 'Invalid claim ID');
  }

  if (req.method !== 'PATCH') {
    return apiResponse.methodNotAllowed(res, req.method!, ['PATCH']);
  }

  try {
    const body = req.body as ContractorClaimReviewPayload;

    if (!body.action || !['approve', 'reject'].includes(body.action)) {
      return apiResponse.badRequest(res, "action must be 'approve' or 'reject'");
    }

    if (body.action === 'approve') {
      if (typeof body.amountApproved !== 'number' || body.amountApproved < 0) {
        return apiResponse.badRequest(res, 'amountApproved is required and must be >= 0 when approving');
      }
    }

    if (body.action === 'reject') {
      if (!body.reviewNotes || !body.reviewNotes.trim()) {
        return apiResponse.badRequest(res, 'reviewNotes is required when rejecting a claim');
      }
    }

    // Load the claim and verify it belongs to this contractor
    const existing = (await sql`
      SELECT id, status FROM contractor_progress_claims
      WHERE id = ${claimId} AND contractor_id = ${contractorId}
    `) as unknown as Array<{ id: string; status: ContractorClaimStatus }>;

    if (!existing[0]) {
      return apiResponse.notFound(res, 'Progress claim not found');
    }

    if (existing[0].status !== 'pending') {
      return apiResponse.badRequest(
        res,
        `Cannot ${body.action} a claim with status '${existing[0].status}'. Only 'pending' claims can be reviewed.`
      );
    }

    const authReq = req as AuthenticatedNextApiRequest;
    if (!authReq.user?.id) {
      return apiResponse.unauthorized(res);
    }

    const reviewedBy = authReq.user.id;
    const newStatus: ContractorClaimStatus = body.action === 'approve' ? 'approved' : 'rejected';
    const amountApproved = body.action === 'approve' ? body.amountApproved! : null;
    const reviewNotes = body.reviewNotes?.trim() ?? null;

    await sql`
      UPDATE contractor_progress_claims
      SET
        status         = ${newStatus},
        amount_approved = ${amountApproved},
        reviewed_by    = ${reviewedBy},
        reviewed_at    = NOW(),
        review_notes   = ${reviewNotes}
      WHERE id = ${claimId}
    `;

    const updatedRows = (await sql`
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
      WHERE cpc.id = ${claimId}
    `) as unknown as ClaimRow[];

    if (!updatedRows[0]) {
      return apiResponse.internalError(res, new Error('Could not retrieve updated claim'));
    }

    log.info('Progress claim reviewed', {
      claimId,
      contractorId,
      action: body.action,
      newStatus,
    });

    return res.status(200).json({ data: mapRow(updatedRows[0]) });
  } catch (error) {
    log.error('Error reviewing progress claim', { error, contractorId, claimId });
    return apiResponse.internalError(res, new Error('Failed to review progress claim'));
  }
}

export default withAuth(handler);
