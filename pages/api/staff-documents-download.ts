/**
 * Staff Document Download/View API
 * GET /api/staff-documents-download?documentId={id}
 * Proxies file from VF Storage to client
 *
 * Query params:
 * - documentId: Required - the document ID
 * - inline: Set to 'true' to view in browser (Content-Disposition: inline)
 *           Default is attachment (download)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { logDocumentDownloaded } from '@/services/staff/staffAuditService';
import { canAccessStaffDocument } from '@/services/staff/staffAccessService';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('StaffDocumentDownloadAPI');

// VF Storage base URL
const VF_STORAGE_URL = process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // withAuth has already attached `user`; AuthenticatedHandler is typed against
  // the base request, so narrow here (same idiom as ./[documentId]/verify.ts).
  const authReq = req as AuthenticatedNextApiRequest;
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { documentId, inline } = req.query;

  if (!documentId || typeof documentId !== 'string') {
    return apiResponse.badRequest(res, 'Document ID is required');
  }

  try {
    // Get document from database
    const [document] = await sql`
      SELECT id, staff_id, document_type, file_path, file_url, file_name, mime_type
      FROM staff_documents WHERE id = ${documentId}
    `;

    if (!document) {
      return apiResponse.notFound(res, 'Document not found');
    }

    // Authorize against the STORED owner and type. A caller-supplied staffId is
    // not consulted: this route used to stream any document's bytes to any
    // signed-in user who knew an id.
    const canAccess = await canAccessStaffDocument(
      authReq.user.id,
      document.staff_id as string,
      document.document_type as string
    );
    if (!canAccess) {
      return apiResponse.forbidden(res, 'You do not have permission to download this document');
    }

    const filePath = (document.file_path || document.file_url) as string;
    const fileName = document.file_name as string || 'document';
    const mimeType = document.mime_type as string || 'application/octet-stream';

    if (!filePath) {
      return apiResponse.notFound(res, 'File path not found');
    }

    // Build VF Storage URL
    // Path format: staff/documents/{filename}
    // URL format: http://VF_STORAGE/staff/documents/{filename}
    let storageUrl: string;

    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      // Already a full URL
      storageUrl = filePath;
    } else {
      // Build URL from path
      storageUrl = `${VF_STORAGE_URL}/${filePath}`;
    }

    // The storage URL is deliberately not logged: a certificate's location must
    // not be recoverable from application logs.
    logger.info('Fetching file from VF Storage', { documentId });

    // Fetch file from VF Storage
    const response = await fetch(storageUrl);

    if (!response.ok) {
      logger.error('VF Storage fetch failed', { documentId, status: response.status });
      return res.status(502).json({ error: 'Failed to fetch file from storage' });
    }

    // Get file content
    const fileBuffer = await response.arrayBuffer();

    // Log to audit trail (only for actual downloads, not inline views)
    if (inline !== 'true') {
      const staffId = document.staff_id as string;
      const documentType = document.document_type as string;
      await logDocumentDownloaded(
        staffId,
        documentType,
        fileName,
        authReq.user?.name || 'System',
        req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress
      );
    }

    // Set response headers
    const disposition = inline === 'true' ? 'inline' : 'attachment';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Length', fileBuffer.byteLength);
    res.setHeader('Cache-Control', 'private, max-age=3600'); // Cache for 1 hour

    // Send file
    res.send(Buffer.from(fileBuffer));
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to download document', { documentId, error: errorMessage });
    return res.status(500).json({ error: 'Failed to download document', message: errorMessage });
  }
}

export default withAuth(withArcjetProtection(handler, aj));
