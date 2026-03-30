/**
 * Contractor Agreement Status Update API
 * PATCH /api/agreements-update?id={agreementId}
 *
 * Updates the status (and optionally the signed document URL) of a
 * contractor agreement. When the status transitions to 'signed',
 * signed_at is automatically stamped with the current timestamp.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';
import { log } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_STATUSES = [
  'draft',
  'pending_review',
  'sent',
  'signed',
  'active',
  'expired',
  'terminated',
] as const;

type AgreementStatus = (typeof VALID_STATUSES)[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UpdateBody {
  status: AgreementStatus;
  signed_document_url?: string;
}

interface AgreementRecord {
  id: string;
  status: string;
  signed_at: string | null;
  signed_document_url: string | null;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const handler = withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'PATCH') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['PATCH']);
  }

  // ── Query param validation ────────────────────────────────────────────────
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Query parameter "id" is required');
  }

  // ── Body validation ───────────────────────────────────────────────────────
  const body = req.body as Partial<UpdateBody>;

  if (!body.status) {
    return apiResponse.badRequest(res, 'Body field "status" is required');
  }

  if (!(VALID_STATUSES as readonly string[]).includes(body.status)) {
    return apiResponse.badRequest(
      res,
      `Invalid status "${body.status}". Must be one of: ${VALID_STATUSES.join(', ')}`
    );
  }

  const status = body.status as AgreementStatus;
  const signedDocumentUrl = body.signed_document_url ?? null;

  // ── Database update ───────────────────────────────────────────────────────
  const sql = neon(process.env.DATABASE_URL!);

  // Verify the record exists before attempting the update.
  const existing = await sql`
    SELECT id FROM contractor_agreements WHERE id = ${id}
  `;

  if (existing.length === 0) {
    return apiResponse.notFound(res, 'Agreement', id);
  }

  // Build the update — signed_at is only set when transitioning to 'signed'.
  const rows = await sql`
    UPDATE contractor_agreements
    SET
      status               = ${status},
      signed_document_url  = COALESCE(${signedDocumentUrl}, signed_document_url),
      signed_at            = CASE WHEN ${status} = 'signed' THEN NOW() ELSE signed_at END,
      updated_at           = NOW()
    WHERE id = ${id}
    RETURNING id, status, signed_at, signed_document_url, updated_at
  `;

  const updated = rows[0] as AgreementRecord;

  log.info('AgreementsUpdate', { id, status, hasSigned: status === 'signed' });

  return apiResponse.success(res, updated);
});

export default withAuth(handler);
