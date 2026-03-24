/**
 * File Serving API - Catch-all route
 * GET /api/uploads/[...path]
 * Proxies files from VF Storage
 *
 * This API proxies requests to VF Storage API for file serving.
 * VF Storage handles actual file storage at 100.96.203.105:8091.
 *
 * @see docs/ARCHITECTURE_STORAGE.md for storage architecture
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import path from 'path';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

// MIME type mapping for common file types
const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
};

const VF_STORAGE_URL = process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    // Get the file path and download flag from the URL
    const { path: pathSegments, download } = req.query;
    const forceDownload = download === 'true' || download === '1';

    if (!pathSegments || !Array.isArray(pathSegments)) {
      return apiResponse.badRequest(res, 'Invalid file path');
    }

    // Join path segments and sanitize
    const filePath = pathSegments.join('/');

    // Prevent path traversal attacks
    if (filePath.includes('..') || filePath.startsWith('/')) {
      return apiResponse.badRequest(res, 'Invalid file path');
    }

    // Proxy request to VF Storage
    const vfUrl = `${VF_STORAGE_URL}/${filePath}`;
    const response = await fetch(vfUrl);

    if (!response.ok) {
      if (response.status === 404) {
        return apiResponse.notFound(res, 'File not found');
      }
      throw new Error(`VF Storage returned ${response.status}`);
    }

    // Get the file buffer
    const fileBuffer = Buffer.from(await response.arrayBuffer());

    // Determine content type from extension or response header
    const ext = path.extname(filePath).toLowerCase();
    const contentType = response.headers.get('content-type') || MIME_TYPES[ext] || 'application/octet-stream';

    // Set response headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=2592000'); // 30 days

    // Extract filename for Content-Disposition
    const fileName = path.basename(filePath);
    // Use 'attachment' to force download, 'inline' to view in browser
    const disposition = forceDownload ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disposition}; filename="${fileName}"`);

    // Send the file
    return res.status(200).send(fileBuffer);
  } catch (error) {
    log.error('File serving error', { error });
    return apiResponse.internalError(res, new Error('Failed to serve file'));
  }
}

// Disable body parser and increase response limit for file serving
export const config = {
  api: {
    bodyParser: false,
    responseLimit: '50mb',
  },
}

export default withAuth(handler);;
