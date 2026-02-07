/**
 * Contractor H&S Documents API
 *
 * GET  /api/health-safety/contractor/[contractorId]/documents - List documents
 * POST /api/health-safety/contractor/[contractorId]/documents - Upload/create document
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { DOCUMENT_TYPES, REQUIRED_DOCUMENTS } from '@/modules/health-safety/types/compliance.types';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { contractorId } = req.query;

  if (!contractorId || typeof contractorId !== 'string') {
    return apiResponse.badRequest(res, 'Contractor ID is required');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(contractorId, req, res);
      case 'POST':
        return handlePost(contractorId, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
    }
  } catch (error) {
    log.error('[H&S Contractor Documents API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(contractorId: string, req: NextApiRequest, res: NextApiResponse) {
  const { status, type } = req.query;

  // Verify contractor exists
  const [contractor] = await sql`
    SELECT id, company_name FROM contractors WHERE id = ${contractorId}
  `;

  if (!contractor) {
    return apiResponse.notFound(res, 'Contractor', contractorId);
  }

  // Get documents
  const documents = await sql`
    SELECT
      d.*,
      CASE
        WHEN d.expiry_date IS NULL THEN 'no_expiry'
        WHEN d.expiry_date < NOW() THEN 'expired'
        WHEN d.expiry_date < NOW() + INTERVAL '30 days' THEN 'expiring_soon'
        ELSE 'valid'
      END as expiry_status
    FROM hs_contractor_documents d
    WHERE d.contractor_id = ${contractorId}
    ${status ? sql`AND d.status = ${status}` : sql``}
    ${type ? sql`AND d.document_type = ${type}` : sql``}
    ORDER BY d.document_type, d.created_at DESC
  `;

  // Group by type for easy display
  const byType: Record<string, any[]> = {};
  for (const doc of documents) {
    const type = (doc as any).document_type;
    if (!byType[type]) {
      byType[type] = [];
    }
    byType[type].push(doc);
  }

  // Calculate compliance summary
  const requiredDocs = REQUIRED_DOCUMENTS;
  const compliance: Record<string, { required: boolean; status: string; document?: any }> = {};

  for (const docType of requiredDocs) {
    const docs = byType[docType] || [];
    const validDoc = docs.find(
      (d: any) =>
        d.status === 'valid' && (!d.expiry_date || new Date(d.expiry_date) > new Date())
    );

    compliance[docType] = {
      required: true,
      status: validDoc
        ? 'valid'
        : docs.length > 0
          ? 'invalid'
          : 'missing',
      document: validDoc || docs[0],
    };
  }

  // Add non-required document types
  for (const docType of Object.keys(DOCUMENT_TYPES)) {
    if (!requiredDocs.includes(docType as any)) {
      const docs = byType[docType] || [];
      if (docs.length > 0) {
        compliance[docType] = {
          required: false,
          status: docs[0].status,
          document: docs[0],
        };
      }
    }
  }

  const validCount = Object.values(compliance).filter((c) => c.status === 'valid').length;
  const requiredCount = requiredDocs.length;

  return apiResponse.success(res, {
    contractor: {
      id: contractor.id,
      company_name: contractor.company_name,
    },
    documents,
    by_type: byType,
    compliance,
    summary: {
      total: documents.length,
      valid: documents.filter((d: any) => d.status === 'valid').length,
      expired: documents.filter((d: any) => d.expiry_status === 'expired').length,
      expiring_soon: documents.filter((d: any) => d.expiry_status === 'expiring_soon').length,
      required_valid: validCount,
      required_total: requiredCount,
      percentage: requiredCount > 0 ? Math.round((validCount / requiredCount) * 100) : 0,
    },
  });
}

async function handlePost(contractorId: string, req: NextApiRequest, res: NextApiResponse) {
  const {
    document_type,
    document_number,
    file_url,
    file_name,
    issue_date,
    expiry_date,
    notes,
  } = req.body;

  if (!document_type) {
    return apiResponse.badRequest(res, 'Document type is required');
  }

  if (!DOCUMENT_TYPES[document_type as keyof typeof DOCUMENT_TYPES]) {
    return apiResponse.badRequest(res, `Invalid document type: ${document_type}`);
  }

  // Verify contractor exists
  const [contractor] = await sql`
    SELECT id, company_name FROM contractors WHERE id = ${contractorId}
  `;

  if (!contractor) {
    return apiResponse.notFound(res, 'Contractor', contractorId);
  }

  // Determine initial status
  let status = 'pending_review';
  if (expiry_date && new Date(expiry_date) < new Date()) {
    status = 'expired';
  }

  // Create document record
  const [document] = await sql`
    INSERT INTO hs_contractor_documents (
      contractor_id, document_type, document_number, file_url, file_name,
      issue_date, expiry_date, status, notes
    ) VALUES (
      ${contractorId},
      ${document_type},
      ${document_number || null},
      ${file_url || null},
      ${file_name || null},
      ${issue_date || null},
      ${expiry_date || null},
      ${status},
      ${notes || null}
    )
    RETURNING *
  `;

  // Log activity
  await sql`
    INSERT INTO hs_activity_log (entity_type, entity_id, action, details)
    VALUES ('contractor_document', ${document.id}, 'created', ${JSON.stringify({
      contractor_id: contractorId,
      company_name: contractor.company_name,
      document_type,
      file_name,
    })}::jsonb)
  `;

  return apiResponse.created(res, {
    ...document,
    type_info: DOCUMENT_TYPES[document_type as keyof typeof DOCUMENT_TYPES],
  });
}

export default withAuth(handler);
