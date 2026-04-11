/**
 * Project Document API - Single document operations
 * GET /api/projects/[projectId]/documents/[documentId] - Get document details
 * DELETE /api/projects/[projectId]/documents/[documentId] - Soft delete document
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withRole, type AuthenticatedNextApiRequest } from '@/lib/auth';
import type { ProjectDocument, ProjectDocumentType } from '@/modules/projects/types/po-extraction.types';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withRole('super_admin')(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const userId = (req as AuthenticatedNextApiRequest).user.id;
  const projectId = req.query.projectId as string;
  const documentId = req.query.documentId as string;

  if (!projectId) {
    return apiResponse.badRequest(res, 'Project ID is required');
  }
  if (!documentId) {
    return apiResponse.badRequest(res, 'Document ID is required');
  }

  // GET - Get document details
  if (req.method === 'GET') {
    try {
      const result = await sql`
        SELECT
          pd.*,
          cpo.po_number as client_po_number
        FROM project_documents pd
        LEFT JOIN client_purchase_orders cpo ON cpo.id = pd.client_po_id
        WHERE pd.id = ${documentId}
          AND pd.project_id = ${projectId}
      `;

      const doc = result[0];
      if (!doc) {
        return apiResponse.notFound(res, 'Document', documentId);
      }

      return apiResponse.success(res, {
        document: transformDocument(doc),
      });
    } catch (error) {
      log.error('Failed to fetch document', { projectId, documentId, error });
      return apiResponse.databaseError(res, error, 'Failed to fetch document');
    }
  }

  // DELETE - Soft delete document
  if (req.method === 'DELETE') {
    try {
      // Check document exists
      const existing = await sql`
        SELECT id, document_type, document_name
        FROM project_documents
        WHERE id = ${documentId}
          AND project_id = ${projectId}
      `;

      if (existing.length === 0) {
        return apiResponse.notFound(res, 'Document', documentId);
      }

      // Soft delete
      await sql`
        UPDATE project_documents
        SET is_active = false, updated_at = NOW()
        WHERE id = ${documentId}
      `;

      const deletedDoc = existing[0];
      log.info('[ProjectDocs] Document deleted', {
        projectId,
        documentId,
        documentType: deletedDoc?.document_type,
        documentName: deletedDoc?.document_name,
        deletedBy: userId,
      });

      return apiResponse.success(res, {
        deleted: true,
        documentId,
      });
    } catch (error) {
      log.error('Failed to delete document', { projectId, documentId, error });
      return apiResponse.databaseError(res, error, 'Failed to delete document');
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'DELETE']);
})));

function transformDocument(row: Record<string, unknown>): ProjectDocument {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    documentType: row.document_type as ProjectDocumentType,
    documentName: row.document_name as string,
    fileUrl: row.file_url as string,
    filePath: row.file_path as string | undefined,
    fileSize: row.file_size as number | undefined,
    mimeType: row.mime_type as string | undefined,
    description: row.description as string | undefined,
    version: row.version as string | undefined,
    effectiveDate: row.effective_date as string | undefined,
    expiryDate: row.expiry_date as string | undefined,
    clientPoId: row.client_po_id as string | undefined,
    uploadedBy: row.uploaded_by as string,
    uploadedAt: row.uploaded_at as string,
    isActive: row.is_active as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
