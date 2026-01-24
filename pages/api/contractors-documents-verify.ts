/**
 * Contractors Documents Verify API - Flat Endpoint
 * POST /api/contractors-documents-verify
 * Approve or reject a document
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id, action, verifiedBy, verificationNotes, rejectionReason } = req.body;

    // Validate required fields
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Document ID is required' });
    }

    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be "approve" or "reject"' });
    }

    if (!verifiedBy) {
      return res.status(400).json({ error: 'verifiedBy is required' });
    }

    // Check if document exists
    const [existing] = await sql`
      SELECT id FROM contractor_documents WHERE id = ${id}
    `;

    if (!existing) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Update document verification status
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const isVerified = action === 'approve';

    const [updated] = await sql`
      UPDATE contractor_documents
      SET
        is_verified = ${isVerified},
        verified_by = ${verifiedBy},
        verified_at = NOW(),
        verification_notes = ${verificationNotes || null},
        status = ${newStatus},
        rejection_reason = ${action === 'reject' ? rejectionReason || 'Rejected by admin' : null},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    return res.status(200).json({
      success: true,
      data: mapDbToDocument(updated),
      message: `Document ${action}d successfully`
    });

  } catch (error: any) {
    console.error('Error verifying document:', error);
    return res.status(500).json({
      error: 'Failed to verify document',
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
