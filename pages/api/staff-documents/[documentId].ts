/**
 * Staff Document API
 * GET /api/staff-documents/[documentId] - Get single document
 * PUT /api/staff-documents/[documentId] - Update document metadata
 * DELETE /api/staff-documents/[documentId] - Delete document
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { localFileStorage } from '@/services/localFileStorage';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { createLogger } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('StaffDocumentAPI');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { documentId } = req.query;

  if (!documentId || typeof documentId !== 'string') {
    return res.status(400).json({ error: 'Document ID is required' });
  }

  // GET - Fetch single document
  if (req.method === 'GET') {
    try {
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
        return res.status(404).json({ error: 'Document not found' });
      }

      return res.status(200).json({
        success: true,
        document: mapDbToDocument(document),
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
        RETURNING *
      `;

      if (!updated) {
        return res.status(404).json({ error: 'Document not found' });
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
        SELECT * FROM staff_documents WHERE id = ${documentId}
      `;

      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }

      // Delete from local storage
      if (document.file_url) {
        try {
          // Extract path from URL (format: /api/uploads/staff-documents/...)
          const url = document.file_url as string;
          const pathMatch = url.match(/staff-documents\/.*$/);
          if (pathMatch) {
            await localFileStorage.deleteFile(pathMatch[0]);
            logger.info('Deleted file from local storage', { path: pathMatch[0] });
          }
        } catch (storageError: unknown) {
          // Log but don't fail if storage delete fails
          const errorMsg = storageError instanceof Error ? storageError.message : 'Unknown';
          logger.warn('Failed to delete file from local storage', { error: errorMsg });
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

  return res.status(405).json({ error: 'Method not allowed' });
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
