/**
 * Contractors Documents List API - Flat Endpoint
 * GET /api/contractors-documents?contractorId=xxx
 * Lists all documents for a contractor
 *
 * Protected by Arcjet:
 * - Bot detection
 * - Rate limiting (30 req/min)
 * - Attack protection
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withArcjetProtection, ajStrict } from '@/lib/arcjet';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { contractorId, documentType, status } = req.query;

    // Validate required param
    if (!contractorId || typeof contractorId !== 'string') {
      return res.status(400).json({ error: 'contractorId is required' });
    }

    // Build query with optional filters
    let documents;

    if (documentType && status) {
      documents = await sql`
        SELECT * FROM contractor_documents
        WHERE contractor_id = ${contractorId}
          AND document_type = ${documentType}
          AND status = ${status}
        ORDER BY created_at DESC
      `;
    } else if (documentType) {
      documents = await sql`
        SELECT * FROM contractor_documents
        WHERE contractor_id = ${contractorId}
          AND document_type = ${documentType}
        ORDER BY created_at DESC
      `;
    } else if (status) {
      documents = await sql`
        SELECT * FROM contractor_documents
        WHERE contractor_id = ${contractorId}
          AND status = ${status}
        ORDER BY created_at DESC
      `;
    } else {
      documents = await sql`
        SELECT * FROM contractor_documents
        WHERE contractor_id = ${contractorId}
        ORDER BY created_at DESC
      `;
    }

    // Calculate expiry info
    const now = new Date();
    const documentsWithExpiry = documents.map(doc => {
      const mapped = mapDbToDocument(doc);

      // Calculate days until expiry if there's an expiry date
      if (mapped.expiryDate) {
        const expiryTime = new Date(mapped.expiryDate).getTime();
        const nowTime = now.getTime();
        const diffTime = expiryTime - nowTime;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        mapped.daysUntilExpiry = diffDays;
        mapped.isExpired = diffDays < 0;
      }

      return mapped;
    });

    return res.status(200).json({
      success: true,
      data: documentsWithExpiry
    });

  } catch (error: any) {
    log.error('Error fetching documents', { error });
    return res.status(500).json({
      error: 'Failed to fetch documents',
      message: error.message
    });
  }
}

// Export with Arcjet protection and auth
export default withAuth(withArcjetProtection(handler, ajStrict));

// Map database row to ContractorDocument interface
function mapDbToDocument(row: any) {
  return {
    id: row.id,
    contractorId: row.contractor_id,
    documentType: row.document_type,
    documentName: row.document_name,
    documentNumber: row.document_number,
    fileName: row.file_name,
    fileUrl: row.file_url,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    issueDate: row.issue_date ? new Date(row.issue_date) : undefined,
    expiryDate: row.expiry_date ? new Date(row.expiry_date) : undefined,
    isExpired: row.is_expired,
    daysUntilExpiry: row.days_until_expiry,
    isVerified: row.is_verified,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at ? new Date(row.verified_at) : undefined,
    verificationNotes: row.verification_notes,
    status: row.status,
    rejectionReason: row.rejection_reason,
    notes: row.notes,
    tags: row.tags || [],
    uploadedBy: row.uploaded_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
