/**
 * Contractor H&S Document Detail API
 *
 * GET    /api/health-safety/contractor/documents/[documentId] - Get document
 * PUT    /api/health-safety/contractor/documents/[documentId] - Update document
 * DELETE /api/health-safety/contractor/documents/[documentId] - Delete document
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { DOCUMENT_TYPES } from '@/modules/health-safety/types/compliance.types';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { documentId } = req.query;

  if (!documentId || typeof documentId !== 'string') {
    return apiResponse.badRequest(res, 'Document ID is required');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(documentId, res);
      case 'PUT':
        return handlePut(documentId, req, res);
      case 'DELETE':
        return handleDelete(documentId, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
    }
  } catch (error) {
    console.error('[H&S Document Detail API] Error:', error);
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(documentId: string, res: NextApiResponse) {
  const [document] = await sql`
    SELECT
      d.*,
      c.company_name as contractor_name,
      CASE
        WHEN d.expiry_date IS NULL THEN 'no_expiry'
        WHEN d.expiry_date < NOW() THEN 'expired'
        WHEN d.expiry_date < NOW() + INTERVAL '30 days' THEN 'expiring_soon'
        ELSE 'valid'
      END as expiry_status
    FROM hs_contractor_documents d
    JOIN contractors c ON c.id = d.contractor_id
    WHERE d.id = ${documentId}
  `;

  if (!document) {
    return apiResponse.notFound(res, 'Document', documentId);
  }

  return apiResponse.success(res, {
    ...document,
    type_info: DOCUMENT_TYPES[document.document_type as keyof typeof DOCUMENT_TYPES],
  });
}

async function handlePut(documentId: string, req: NextApiRequest, res: NextApiResponse) {
  const { document_number, file_url, file_name, issue_date, expiry_date, status, notes, verified_by } =
    req.body;

  // Get existing document
  const [existing] = await sql`
    SELECT d.*, c.company_name
    FROM hs_contractor_documents d
    JOIN contractors c ON c.id = d.contractor_id
    WHERE d.id = ${documentId}
  `;

  if (!existing) {
    return apiResponse.notFound(res, 'Document', documentId);
  }

  // Calculate status if expiry changed
  let newStatus = status || existing.status;
  const newExpiry = expiry_date !== undefined ? expiry_date : existing.expiry_date;

  if (newExpiry && new Date(newExpiry) < new Date() && newStatus !== 'expired') {
    newStatus = 'expired';
  }

  // If verifying, set verification fields
  const now = new Date().toISOString();
  const verifiedAt = status === 'valid' ? now : existing.verified_at;
  const verifier = status === 'valid' && verified_by ? verified_by : existing.verified_by;

  // Update document
  const [document] = await sql`
    UPDATE hs_contractor_documents
    SET
      document_number = COALESCE(${document_number}, document_number),
      file_url = COALESCE(${file_url}, file_url),
      file_name = COALESCE(${file_name}, file_name),
      issue_date = COALESCE(${issue_date}, issue_date),
      expiry_date = ${newExpiry},
      status = ${newStatus},
      notes = COALESCE(${notes}, notes),
      verified_by = ${verifier},
      verified_at = ${verifiedAt},
      updated_at = NOW()
    WHERE id = ${documentId}
    RETURNING *
  `;

  // Log activity
  const action = status === 'valid' ? 'verified' : status === 'rejected' ? 'rejected' : 'updated';
  await sql`
    INSERT INTO hs_activity_log (entity_type, entity_id, action, actor_id, details)
    VALUES ('contractor_document', ${documentId}, ${action}, ${verified_by || null}, ${JSON.stringify({
      contractor_id: existing.contractor_id,
      company_name: existing.company_name,
      document_type: existing.document_type,
      status: newStatus,
    })}::jsonb)
  `;

  return apiResponse.success(res, {
    ...document,
    type_info: DOCUMENT_TYPES[document.document_type as keyof typeof DOCUMENT_TYPES],
  });
}

async function handleDelete(documentId: string, res: NextApiResponse) {
  // Get existing document
  const [existing] = await sql`
    SELECT d.*, c.company_name
    FROM hs_contractor_documents d
    JOIN contractors c ON c.id = d.contractor_id
    WHERE d.id = ${documentId}
  `;

  if (!existing) {
    return apiResponse.notFound(res, 'Document', documentId);
  }

  // Delete document
  await sql`DELETE FROM hs_contractor_documents WHERE id = ${documentId}`;

  // Log activity
  await sql`
    INSERT INTO hs_activity_log (entity_type, entity_id, action, details)
    VALUES ('contractor_document', ${documentId}, 'deleted', ${JSON.stringify({
      contractor_id: existing.contractor_id,
      company_name: existing.company_name,
      document_type: existing.document_type,
      file_name: existing.file_name,
    })}::jsonb)
  `;

  return apiResponse.success(res, { message: 'Document deleted', id: documentId });
}

export default withAuth(handler);
