/**
 * Unified Storage Delete API
 * DELETE /api/storage/delete
 * Handles file deletion from VF Storage
 *
 * @see docs/ARCHITECTURE_STORAGE.md for storage architecture
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { vfStorage } from '@/services/vfStorageAdapter';
import { log } from '@/lib/logger';

import { withAuth } from '@/lib/auth';
interface DeleteResponse {
  success: boolean;
  error?: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DeleteResponse>
) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { type, category, fileName } = req.body;

    if (!type || !category || !fileName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: type, category, fileName'
      });
    }

    // Delete from VF Storage
    await vfStorage.deleteFile(type, category, fileName);

    log.info(`File deleted: ${storagePath}`, {}, 'storage-delete');

    return res.status(200).json({ success: true });
  } catch (error) {
    log.error('Storage delete error:', { data: error }, 'storage-delete');
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete file',
    });
  }
}

export default withAuth(handler);
