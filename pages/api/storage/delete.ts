/**
 * Unified Storage Delete API
 * DELETE /api/storage/delete — removes a file from VF Storage
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { vfStorage } from '@/services/vfStorageAdapter';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['DELETE']);
  }

  const { type, category, fileName } = req.body;
  if (!type || !category || !fileName) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing required fields: type, category, fileName');
  }

  try {
    await vfStorage.deleteFile(type, category, fileName);
    log.info(`Deleted file: ${type}/${category}/${fileName}`, undefined, 'StorageDelete');
    return apiResponse.success(res, { deleted: true });
  } catch (error) {
    log.error(`Error deleting file: ${error}`, undefined, 'StorageDelete');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
