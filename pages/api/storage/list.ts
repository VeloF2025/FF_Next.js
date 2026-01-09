/**
 * Unified Storage List API
 * GET /api/storage/list?type=X&category=Y
 * Lists files in a directory
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { localFileStorage } from '@/services/localFileStorage';
import { log } from '@/lib/logger';

interface ListResponse {
  success: boolean;
  files?: Array<{
    name: string;
    url: string;
  }>;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ListResponse>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { type, category } = req.query;

    if (!type || !category) {
      return res.status(400).json({
        success: false,
        error: 'Missing required query params: type, category'
      });
    }

    const typeStr = Array.isArray(type) ? type[0] : type;
    const categoryStr = Array.isArray(category) ? category[0] : category;

    // List files from local storage
    const dirPath = `${typeStr}/${categoryStr}`;
    const fileNames = await localFileStorage.listFiles(dirPath);

    const files = fileNames.map(name => ({
      name,
      url: localFileStorage.getFileUrl(`${dirPath}/${name}`),
    }));

    return res.status(200).json({
      success: true,
      files,
    });
  } catch (error) {
    log.error('Storage list error:', { data: error }, 'storage-list');
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list files',
    });
  }
}
