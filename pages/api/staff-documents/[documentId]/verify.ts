/**
 * Staff Document Verification API
 * POST /api/staff-documents/[documentId]/verify
 * Verify or reject a staff document
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { createLogger } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('StaffDocumentVerifyAPI');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { documentId } = req.query;

  if (!documentId || typeof documentId !== 'string') {
    return res.status(400).json({ error: 'Document ID is required' });
  }

  try {
    const { status, notes } = req.body;

    // Validate status
    if (!status || !['verified', 'rejected'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid status. Must be "verified" or "rejected"',
      });
    }

    // Get the current user for verifier ID
    // In production, this would come from Clerk auth

    // Find staff member by clerk ID if available
    let verifierId: string | null = null;
    if (userId) {
      const [staffMember] = await sql`
        SELECT id FROM staff WHERE clerk_id = ${userId}
      `;
      if (staffMember) {
        verifierId = staffMember.id as string;
      }
    }

    // Update document verification status
    const [updated] = await sql`
      UPDATE staff_documents
      SET
        verification_status = ${status},
        verified_by = ${verifierId},
        verified_at = NOW(),
        verification_notes = ${notes || null},
        updated_at = NOW()
      WHERE id = ${documentId}
      RETURNING *
    `;

    if (!updated) {
      return res.status(404).json({ error: 'Document not found' });
    }

    logger.info('Document verification updated', { documentId, status, verifierId });

    // Get full document with joins
    const [document] = await sql`
      SELECT
        sd.*,
        s.name as staff_name,
        v.name as verifier_name
      FROM staff_documents sd
      LEFT JOIN staff s ON s.id = sd.staff_id
      LEFT JOIN staff v ON v.id = sd.verified_by
      WHERE sd.id = ${documentId}
    `;

    if (!document) {
      return res.status(404).json({ error: 'Document not found after verification' });
    }

    return res.status(200).json({
      success: true,
      document: mapDbToDocument(document as Record<string, unknown>),
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to verify document', { documentId, error: errorMessage });
    return res.status(500).json({ error: 'Failed to verify document', message: errorMessage });
  }
}

export default withArcjetProtection(handler, aj);

// Map database row to StaffDocument interface
function mapDbToDocument(row: Record<string, unknown>) {
  return {
    id: row.id,
    staffId: row.staff_id,
    documentType: row.document_type,
    documentName: row.document_name,
    fileUrl: row.file_url,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    expiryDate: row.expiry_date ? new Date(row.expiry_date as string).toISOString() : undefined,
    issuedDate: row.issued_date ? new Date(row.issued_date as string).toISOString() : undefined,
    issuingAuthority: row.issuing_authority,
    documentNumber: row.document_number,
    verificationStatus: row.verification_status,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at ? new Date(row.verified_at as string).toISOString() : undefined,
    verificationNotes: row.verification_notes,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    staff: row.staff_name ? { id: row.staff_id, name: row.staff_name } : undefined,
    verifier: row.verifier_name ? { id: row.verified_by, name: row.verifier_name } : undefined,
  };
}
