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
import {
  canAccessStaffDocuments,
  canAccessTrainingCertificates,
} from '@/services/staff/staffAccessService';
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
      // Three scopes, decided server-side:
      //   full HR / self          — every document type, as before;
      //   certificate custodian   — certification documents only, so a training
      //                             grant never widens into IDs and bank details;
      //   neither                 — nothing.
      const canAccessAll = await canAccessStaffDocuments(userId, staffId);
      const canAccessCertificates = canAccessAll || (await canAccessTrainingCertificates(userId));
      if (!canAccessCertificates) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to view documents for this staff member'
        });
      }
      // Explicit branches rather than a conditional fragment: the Neon shim
      // binds every interpolation as a parameter, so SQL cannot be spliced in.
      // The projection is column-by-column and deliberately excludes file_path
      // and file_url — the binary is reachable only through the protected
      // download route, which re-checks permission per request.
      const documents = canAccessAll
        ? await sql`
            SELECT
              sd.id, sd.staff_id, sd.document_type, sd.document_name,
              sd.file_size, sd.mime_type, sd.expiry_date, sd.issued_date,
              sd.issuing_authority, sd.document_number, sd.verification_status,
              sd.verified_by, sd.verified_at, sd.verification_notes,
              sd.ocr_metadata, sd.created_at, sd.updated_at,
              CONCAT(s.first_name, ' ', s.last_name) as staff_name,
              CONCAT(v.first_name, ' ', v.last_name) as verifier_name
            FROM staff_documents sd
            LEFT JOIN staff s ON s.id = sd.staff_id
            LEFT JOIN staff v ON v.id = sd.verified_by
            WHERE sd.staff_id = ${staffId}
            ORDER BY sd.created_at DESC
          `
        : await sql`
            SELECT
              sd.id, sd.staff_id, sd.document_type, sd.document_name,
              sd.file_size, sd.mime_type, sd.expiry_date, sd.issued_date,
              sd.issuing_authority, sd.document_number, sd.verification_status,
              sd.verified_by, sd.verified_at, sd.verification_notes,
              sd.ocr_metadata, sd.created_at, sd.updated_at,
              CONCAT(s.first_name, ' ', s.last_name) as staff_name,
              CONCAT(v.first_name, ' ', v.last_name) as verifier_name
            FROM staff_documents sd
            LEFT JOIN staff s ON s.id = sd.staff_id
            LEFT JOIN staff v ON v.id = sd.verified_by
            WHERE sd.staff_id = ${staffId}
              AND sd.document_type = 'certification'
            ORDER BY sd.created_at DESC
          `;

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
    // The protected route, never the storage location.
    downloadUrl: `/api/staff-documents-download?documentId=${row.id as string}`,
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
