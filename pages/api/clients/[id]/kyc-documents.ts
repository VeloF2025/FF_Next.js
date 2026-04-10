/**
 * KYC Documents API
 * 
 * GET /api/clients/[id]/kyc-documents - List all KYC documents for client
 * POST /api/clients/[id]/kyc-documents - Upload new KYC document
 * 
 * Auth: Required (withAuth)
 */

import type { NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { neon } from '@neondatabase/serverless';

const COMPONENT = 'KYCDocumentsAPI';

interface KYCDocumentRow {
  id: string;
  client_id: string;
  document_type: string;
  status: string;
  filename: string | null;
  file_url: string | null;
  file_size: number | null;
  uploaded_at: string | null;
  uploaded_by: string | null;
  verified_at: string | null;
  verified_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const userId = req.user.id;
  const { id: clientId } = req.query;

  if (!clientId || typeof clientId !== 'string') {
    return apiResponse.badRequest(res, 'Client ID is required');
  }

  try {
    if (req.method === 'GET') {
      return await handleGetDocuments(res, clientId, userId);
    }

    if (req.method === 'POST') {
      return await handleUploadDocument(req, res, clientId, userId);
    }

    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
  } catch (error) {
    logger.error('KYC documents request failed', { error, clientId, method: req.method }, COMPONENT);
    return apiResponse.internalError(res);
  }
}

async function handleGetDocuments(res: NextApiResponse, clientId: string, userId: string) {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    
    // Verify client exists and user has access
    const clientCheck = await sql`
      SELECT id FROM clients WHERE id = ${clientId}
    `;

    if (clientCheck.length === 0) {
      logger.warn('Client not found', { clientId, userId }, COMPONENT);
      return apiResponse.notFound(res, 'Client not found');
    }

    // Fetch all KYC documents for this client
    const documents = await sql<KYCDocumentRow[]>`
      SELECT 
        id,
        client_id,
        document_type,
        status,
        filename,
        file_url,
        file_size,
        uploaded_at,
        uploaded_by,
        verified_at,
        verified_by,
        rejected_at,
        rejected_by,
        rejection_reason,
        notes,
        created_at,
        updated_at
      FROM kyc_documents
      WHERE client_id = ${clientId}
      ORDER BY created_at DESC
    `;

    logger.info('KYC documents retrieved', { clientId, count: documents.length }, COMPONENT);

    return apiResponse.success(res, {
      documents: documents.map((doc) => ({
        id: doc.id,
        clientId: doc.client_id,
        documentType: doc.document_type,
        status: doc.status,
        filename: doc.filename,
        fileUrl: doc.file_url,
        fileSize: doc.file_size,
        uploadedAt: doc.uploaded_at,
        uploadedBy: doc.uploaded_by,
        verifiedAt: doc.verified_at,
        verifiedBy: doc.verified_by,
        rejectedAt: doc.rejected_at,
        rejectedBy: doc.rejected_by,
        rejectionReason: doc.rejection_reason,
        notes: doc.notes,
        createdAt: doc.created_at,
        updatedAt: doc.updated_at,
      })),
    });
  } catch (error) {
    logger.error('Failed to fetch KYC documents', { error, clientId }, COMPONENT);
    throw error;
  }
}

async function handleUploadDocument(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
  clientId: string,
  userId: string
) {
  const { documentType, filename, fileUrl, fileSize, notes } = req.body;

  if (!documentType || !filename || !fileUrl) {
    return apiResponse.badRequest(res, 'documentType, filename, and fileUrl are required');
  }

  const validDocumentTypes = [
    'PROOF_OF_ID',
    'PROOF_OF_ADDRESS',
    'PROOF_OF_BANKING',
    'COMPANY_REGISTRATION',
    'TAX_CLEARANCE',
    'VAT_CERTIFICATE',
  ];

  if (!validDocumentTypes.includes(documentType)) {
    return apiResponse.badRequest(res, 'Invalid document type');
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);

    // Verify client exists
    const clientCheck = await sql`
      SELECT id FROM clients WHERE id = ${clientId}
    `;

    if (clientCheck.length === 0) {
      logger.warn('Client not found', { clientId, userId }, COMPONENT);
      return apiResponse.notFound(res, 'Client not found');
    }

    // Check if document of this type already exists for this client
    const existingDoc = await sql`
      SELECT id FROM kyc_documents 
      WHERE client_id = ${clientId} 
      AND document_type = ${documentType}
      AND status IN ('uploaded', 'verified')
    `;

    if (existingDoc.length > 0) {
      return apiResponse.badRequest(
        res,
        'Document of this type already exists. Please delete or update the existing document.'
      );
    }

    // Insert new document
    const newDoc = await sql<KYCDocumentRow[]>`
      INSERT INTO kyc_documents (
        client_id,
        document_type,
        status,
        filename,
        file_url,
        file_size,
        uploaded_at,
        uploaded_by,
        notes
      ) VALUES (
        ${clientId},
        ${documentType},
        'uploaded',
        ${filename},
        ${fileUrl},
        ${fileSize || null},
        NOW(),
        ${userId},
        ${notes || null}
      )
      RETURNING *
    `;

    logger.info('KYC document uploaded', { clientId, documentType, userId }, COMPONENT);

    return apiResponse.success(res, {
      document: {
        id: newDoc[0]!.id,
        clientId: newDoc[0]!.client_id,
        documentType: newDoc[0]!.document_type,
        status: newDoc[0]!.status,
        filename: newDoc[0]!.filename,
        fileUrl: newDoc[0]!.file_url,
        fileSize: newDoc[0]!.file_size,
        uploadedAt: newDoc[0]!.uploaded_at,
        uploadedBy: newDoc[0]!.uploaded_by,
        createdAt: newDoc[0]!.created_at,
        updatedAt: newDoc[0]!.updated_at,
      },
    });
  } catch (error) {
    logger.error('Failed to upload KYC document', { error, clientId, documentType }, COMPONENT);
    throw error;
  }
}

export default withAuth(handler);
