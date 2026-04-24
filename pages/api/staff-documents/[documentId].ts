/**
 * Staff Document API
 * GET /api/staff-documents/[documentId] - Get single document
 * PUT /api/staff-documents/[documentId] - Update document metadata
 * DELETE /api/staff-documents/[documentId] - Delete document (VF Storage)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { deleteStaffDocument } from '@/services/vfStorageAdapter';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { withAuth } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('StaffDocumentAPI');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { documentId } = req.query;

  if (!documentId || typeof documentId !== 'string') {
    return apiResponse.badRequest(res, 'Document ID is required');
  }

  // GET - Fetch single document
  if (req.method === 'GET') {
    try {
      const [document] = await sql`
        SELECT
          sd.id, sd.staff_id, sd.document_type, sd.document_name, sd.file_url,
          sd.file_path, sd.file_size, sd.file_name, sd.mime_type, sd.expiry_date,
          sd.issued_date, sd.issuing_authority, sd.document_number,
          sd.verification_status, sd.verified_by, sd.verified_at, sd.verification_notes,
          sd.ocr_metadata,
          sd.created_at, sd.updated_at,
          s.name as staff_name,
          v.name as verifier_name
        FROM staff_documents sd
        LEFT JOIN staff s ON s.id = sd.staff_id
        LEFT JOIN staff v ON v.id = sd.verified_by
        WHERE sd.id = ${documentId}
      `;

      if (!document) {
        return apiResponse.notFound(res, 'Document not found');
      }

      return res.status(200).json({
        success: true,
        data: mapDbToDocument(document),
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to fetch document', { documentId, error: errorMessage });
      return res.status(500).json({ error: 'Failed to fetch document', message: errorMessage });
    }
  }

  // PUT - Update document metadata
  if (req.method === 'PUT') {
    try {
      const { documentName, expiryDate, issuedDate, issuingAuthority, documentNumber } = req.body;

      const [updated] = await sql`
        UPDATE staff_documents
        SET
          document_name = COALESCE(${documentName || null}, document_name),
          expiry_date = COALESCE(${expiryDate ? new Date(expiryDate) : null}, expiry_date),
          issued_date = COALESCE(${issuedDate ? new Date(issuedDate) : null}, issued_date),
          issuing_authority = COALESCE(${issuingAuthority || null}, issuing_authority),
          document_number = COALESCE(${documentNumber || null}, document_number),
          updated_at = NOW()
        WHERE id = ${documentId}
        RETURNING id, staff_id, document_type, document_name, file_url, file_path,
                 file_size, file_name, mime_type, expiry_date, issued_date,
                 issuing_authority, document_number, verification_status, verified_by,
                 verified_at, verification_notes, created_at, updated_at
      `;

      if (!updated) {
        return apiResponse.notFound(res, 'Document not found');
      }

      logger.info('Document updated', { documentId });

      return res.status(200).json({
        success: true,
        document: mapDbToDocument(updated),
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to update document', { documentId, error: errorMessage });
      return res.status(500).json({ error: 'Failed to update document', message: errorMessage });
    }
  }

  // DELETE - Delete document
  if (req.method === 'DELETE') {
    try {
      // First, get the document to find the file URL
      const [document] = await sql`
        SELECT id, file_path, file_url FROM staff_documents WHERE id = ${documentId}
      `;

      if (!document) {
        return apiResponse.notFound(res, 'Document not found');
      }

      // Delete from VF Storage
      if (document.file_path || document.file_url) {
        try {
          const filePath = (document.file_path || document.file_url) as string;

          // Extract filename from path
          // Path format: staff/documents/{staffId}_{originalFilename}
          // Or URL format: http://100.96.203.105:8091/staff/documents/{filename}
          const pathParts = filePath.split('/');
          const filename = pathParts[pathParts.length - 1];

          if (filename) {
            // Extract staffId from filename prefix (format: {staffId}_{originalFilename})
            const staffIdFromFilename = filename.split('_')[0] ?? '';
            const deleted = await deleteStaffDocument(staffIdFromFilename, filename);
            if (deleted) {
              logger.info('Deleted file from VF Storage', { filename });
            } else {
              logger.warn('VF Storage delete returned false', { filename });
            }
          }
        } catch (storageError: unknown) {
          // Log but don't fail if storage delete fails
          const errorMsg = storageError instanceof Error ? storageError.message : 'Unknown';
          logger.warn('Failed to delete file from VF Storage', { error: errorMsg });
        }
      }

      // Delete from database
      await sql`DELETE FROM staff_documents WHERE id = ${documentId}`;

      logger.info('Document deleted', { documentId });

      return res.status(200).json({
        success: true,
        message: 'Document deleted successfully',
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to delete document', { documentId, error: errorMessage });
      return res.status(500).json({ error: 'Failed to delete document', message: errorMessage });
    }
  }

  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'PUT', 'DELETE']);
}

export default withAuth(withArcjetProtection(handler, aj));

// Map database row to the StaffDocument shape the UI expects.
// The DocumentVerificationModal reads: id, documentType, fileName, fileUrl,
// verificationStatus, ocrConfidence, ocrMetadata, notes, createdAt, staffName.
// We also keep the legacy fields (documentName, verificationNotes, staff{})
// for other callers that may still depend on them.
function mapDbToDocument(row: Record<string, unknown>) {
  const ocrMetadata = (row.ocr_metadata ?? null) as Record<string, unknown> | null;
  // ocr_confidence isn't stored as its own column; callers extract from
  // metadata if present.
  const ocrConfidence =
    ocrMetadata && typeof ocrMetadata.confidence === 'number'
      ? (ocrMetadata.confidence as number)
      : null;

  return {
    id: row.id,
    staffId: row.staff_id,
    documentType: row.document_type,
    // Prefer the real uploaded filename; fall back to the friendly
    // document name or a generic label so the modal never shows "undefined".
    fileName:
      (row.file_name as string | null) ??
      (row.document_name as string | null) ??
      'Document',
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
    notes: row.verification_notes,
    ocrMetadata,
    ocrConfidence,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    staffName: row.staff_name ?? null,
    staff: row.staff_name ? { id: row.staff_id, name: row.staff_name } : undefined,
    verifier: row.verifier_name ? { id: row.verified_by, name: row.verifier_name } : undefined,
  };
}
