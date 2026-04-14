/**
 * Staff Documents API
 * GET /api/staff/[staffId]/documents - Get all documents for a staff member
 */

import type { NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { createLogger } from '@/lib/logger';
import type { DocumentType, VerificationStatus } from '@/types/staff-document.types';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { canAccessStaffDocuments } from '@/services/staff/staffAccessService';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('StaffDocumentsAPI');

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { staffId, documentType, verificationStatus } = req.query;
  const userId = req.user.id;

  if (!staffId || typeof staffId !== 'string') {
    return apiResponse.badRequest(res, 'Staff ID is required');
  }

  if (req.method === 'GET') {
    try {
      // Check if user can access documents for this staff member
      const canAccess = await canAccessStaffDocuments(userId, staffId);
      if (!canAccess) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to view documents for this staff member'
        });
      }
      let query = sql`
        SELECT
          sd.*,
          s.name as staff_name,
          v.name as verifier_name
        FROM staff_documents sd
        LEFT JOIN staff s ON s.id = sd.staff_id
        LEFT JOIN staff v ON v.id = sd.verified_by
        WHERE sd.staff_id = ${staffId}
      `;

      // Apply filters
      if (documentType && typeof documentType === 'string') {
        query = sql`
          SELECT
            sd.*,
            s.name as staff_name,
            v.name as verifier_name
          FROM staff_documents sd
          LEFT JOIN staff s ON s.id = sd.staff_id
          LEFT JOIN staff v ON v.id = sd.verified_by
          WHERE sd.staff_id = ${staffId}
            AND sd.document_type = ${documentType}
        `;
      }

      if (verificationStatus && typeof verificationStatus === 'string') {
        query = sql`
          SELECT
            sd.*,
            s.name as staff_name,
            v.name as verifier_name
          FROM staff_documents sd
          LEFT JOIN staff s ON s.id = sd.staff_id
          LEFT JOIN staff v ON v.id = sd.verified_by
          WHERE sd.staff_id = ${staffId}
            AND sd.verification_status = ${verificationStatus}
        `;
      }

      // If both filters
      if (documentType && verificationStatus && typeof documentType === 'string' && typeof verificationStatus === 'string') {
        query = sql`
          SELECT
            sd.*,
            s.name as staff_name,
            v.name as verifier_name
          FROM staff_documents sd
          LEFT JOIN staff s ON s.id = sd.staff_id
          LEFT JOIN staff v ON v.id = sd.verified_by
          WHERE sd.staff_id = ${staffId}
            AND sd.document_type = ${documentType}
            AND sd.verification_status = ${verificationStatus}
        `;
      }

      // Execute query - need to rebuild without filters for now due to tagged template limitations
      const documents = await sql`
        SELECT
          sd.*,
          CONCAT(s.first_name, ' ', s.last_name) as staff_name,
          CONCAT(v.first_name, ' ', v.last_name) as verifier_name
        FROM staff_documents sd
        LEFT JOIN staff s ON s.id = sd.staff_id
        LEFT JOIN staff v ON v.id = sd.verified_by
        WHERE sd.staff_id = ${staffId}
        ORDER BY sd.created_at DESC
      `;

      // Filter in JS if needed (tagged templates make dynamic WHERE harder)
      let filtered = documents;
      if (documentType && typeof documentType === 'string') {
        filtered = filtered.filter(d => d.document_type === documentType);
      }
      if (verificationStatus && typeof verificationStatus === 'string') {
        filtered = filtered.filter(d => d.verification_status === verificationStatus);
      }

      return res.status(200).json({
        success: true,
        documents: filtered.map(mapDbToDocument),
        count: filtered.length,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to fetch staff documents', { staffId, error: errorMessage });
      return res.status(500).json({ error: 'Failed to fetch documents', message: errorMessage });
    }
  }

  return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
}

export default withAuth(withArcjetProtection(handler as any, aj));

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
    // OCR-extracted metadata for document verification review
    ocrMetadata: row.ocr_metadata || undefined,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    staff: row.staff_name ? { id: row.staff_id, name: row.staff_name } : undefined,
    verifier: row.verifier_name ? { id: row.verified_by, name: row.verifier_name } : undefined,
  };
}
