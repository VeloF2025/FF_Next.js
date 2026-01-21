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

const STORAGE_API_URL = process.env.STORAGE_API_URL || 'http://100.96.203.105:8091';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get the path segments
    const pathSegments = req.query.path;
    if (!pathSegments || !Array.isArray(pathSegments) || pathSegments.length < 3) {
      return res.status(400).json({ error: 'Invalid document path' });
    }

    // Build the storage API URL
    // Expected format: /api/pipeline/documents/pipeline/{projectId}/{filename}
    const storagePath = pathSegments.join('/');
    const storageUrl = `${STORAGE_API_URL}/${storagePath}`;

    console.log(`[Document Proxy] Fetching: ${storageUrl}`);

    // Fetch from storage API
    const response = await fetch(storageUrl);

    if (!response.ok) {
      if (response.status === 404) {
        return res.status(404).json({ error: 'Document not found' });
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
    const filename = pathSegments[pathSegments.length - 1];
    if (filename.toLowerCase().endsWith('.pdf')) {
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    }

    // Stream the response
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));

  } catch (error) {
    console.error('[Document Proxy] Error:', error);
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
