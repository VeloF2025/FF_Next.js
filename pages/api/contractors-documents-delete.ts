/**
 * Contractors Documents Delete API - Flat Endpoint
 * POST /api/contractors-documents-delete
 * Deletes document from VF Storage AND database
 *
 * @see docs/ARCHITECTURE_STORAGE.md for storage architecture
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { vfStorage } from '@/services/vfStorageAdapter';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  try {
    const { id } = req.body;

    // Validate required field
    if (!id || typeof id !== 'string') {
      return apiResponse.badRequest(res, 'Document ID is required');
    }

    // Get document to get file path
    const [document] = await sql`
      SELECT id, file_path FROM contractor_documents WHERE id = ${id}
    `;

    if (!document) {
      return apiResponse.notFound(res, 'Document not found');
    }

    // Delete from VF Storage
    try {
      if (document.file_path) {
        // Parse storage path: contractors/documents/{filename}
        const pathParts = document.file_path.split('/');
        if (pathParts.length >= 3) {
          const filename = pathParts[pathParts.length - 1];
          await vfStorage.deleteFile('contractors', 'documents', filename);
        }
      }
    } catch (storageError) {
      log.error('VF Storage delete error', { error: storageError });
      // Continue even if file delete fails (file might already be gone)
    }

    // Delete from database
    await sql`DELETE FROM contractor_documents WHERE id = ${id}`;

    return res.status(200).json({
      success: true,
      message: 'Document deleted successfully'
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error deleting document', { error: errorMessage });
    return res.status(500).json({
      error: 'Failed to delete document',
      message: errorMessage
    });
  }
}

export default withAuth(handler);
