/**
 * Contractors Documents Update API - Flat Endpoint
 * PUT /api/contractors-documents-update
 * Updates document metadata (not the file itself)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      id,
      documentType,
      documentName,
      documentNumber,
      issueDate,
      expiryDate,
      notes,
      status
    } = req.body;

    // Validate required field
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Document ID is required' });
    }

    // Check if document exists
    const [existing] = await sql`
      SELECT id FROM contractor_documents WHERE id = ${id}
    `;

    if (!existing) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Update document
    const [updated] = await sql`
      UPDATE contractor_documents
      SET
        document_type = COALESCE(${documentType || null}, document_type),
        document_name = COALESCE(${documentName || null}, document_name),
        document_number = COALESCE(${documentNumber || null}, document_number),
        issue_date = COALESCE(${issueDate ? new Date(issueDate) : null}, issue_date),
        expiry_date = COALESCE(${expiryDate ? new Date(expiryDate) : null}, expiry_date),
        notes = COALESCE(${notes || null}, notes),
        status = COALESCE(${status || null}, status),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    return res.status(200).json({
      success: true,
      data: mapDbToDocument(updated)
    });

  } catch (error: any) {
    console.error('Error updating document:', error);
    return res.status(500).json({
      error: 'Failed to update document',
      message: error.message
    });
  }
}

// Map database row to ContractorDocument interface
function mapDbToDocument(row: any) {
  return {
    id: row.id,
    contractorId: row.contractor_id,
    documentType: row.document_type,
    documentName: row.document_name,
    documentNumber: row.document_number,
    fileName: row.file_name,
    filePath: row.file_path,
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

export default withAuth(handler);
