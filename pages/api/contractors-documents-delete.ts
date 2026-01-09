/**
 * Contractors Documents Delete API - Flat Endpoint
 * POST /api/contractors-documents-delete
 * Deletes document from local storage AND database
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { localFileStorage } from '@/services/localFileStorage';

const sql = neon(process.env.DATABASE_URL || '');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.body;

    // Validate required field
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Document ID is required' });
    }

    // Get document to get file path
    const [document] = await sql`
      SELECT id, file_path FROM contractor_documents WHERE id = ${id}
    `;

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Delete from local storage
    try {
      if (document.file_path) {
        await localFileStorage.deleteFile(document.file_path);
      }
    } catch (storageError) {
      console.error('Local storage delete error:', storageError);
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
    console.error('Error deleting document:', errorMessage);
    return res.status(500).json({
      error: 'Failed to delete document',
      message: errorMessage
    });
  }
}
