/**
 * Pipeline Document Proxy API
 * Serves documents from the Velocity storage API
 *
 * Supports:
 * - /api/pipeline/documents/pipeline/{projectId}/{filename} - Smartsheet synced docs
 * - Proper content-type headers for PDF, images, etc.
 * - Caching headers for performance
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const VF_STORAGE_URL = process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    // Get the path segments
    const pathSegments = req.query.path;
    if (!pathSegments || !Array.isArray(pathSegments) || pathSegments.length < 3) {
      return apiResponse.badRequest(res, 'Invalid document path');
    }

    // Build the storage API URL
    // Expected format: /api/pipeline/documents/pipeline/{projectId}/{filename}
    const storagePath = pathSegments.join('/');
    const storageUrl = `${VF_STORAGE_URL}/${storagePath}`;

    log.debug('documentProxy', { action: 'fetch', storageUrl });

    // Fetch from storage API
    const response = await fetch(storageUrl);

    if (!response.ok) {
      if (response.status === 404) {
        return apiResponse.notFound(res, 'Document not found');
      }
      throw new Error(`Storage API error: ${response.status}`);
    }

    // Get content type from storage API response
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentLength = response.headers.get('content-length');

    // Set response headers
    res.setHeader('Content-Type', contentType);
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache 24 hours

    // For PDFs, set inline display
    const filename = pathSegments[pathSegments.length - 1]!;
    if (filename.toLowerCase().endsWith('.pdf')) {
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    }

    // Stream the response
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));

  } catch (error) {
    log.error('documentProxy', { action: 'fetch', error });
    res.status(500).json({
      error: 'Failed to fetch document',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Disable body parsing for streaming
export const config = {
  api: {
    responseLimit: '100mb',
  },
};

export default withAuth(handler);
