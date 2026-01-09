/**
 * File Serving API - Catch-all route
 * GET /api/uploads/[...path]
 * Serves files from local storage
 *
 * In production, nginx should serve /uploads directly for better performance.
 * This API serves as a fallback for development and authenticated file access.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { localFileStorage } from '@/services/localFileStorage';
import path from 'path';

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get the file path from the URL
    const { path: pathSegments } = req.query;

    if (!pathSegments || !Array.isArray(pathSegments)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    // Join path segments and sanitize
    const filePath = pathSegments.join('/');

    // Prevent path traversal attacks
    if (filePath.includes('..') || filePath.startsWith('/')) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    // Check if file exists
    const exists = await localFileStorage.fileExists(filePath);
    if (!exists) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Get the file
    const fileBuffer = await localFileStorage.getFile(filePath);
    if (!fileBuffer) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Determine content type from extension
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Set response headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=2592000'); // 30 days

    // Extract filename for Content-Disposition
    const fileName = path.basename(filePath);
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);

    // Send the file
    return res.status(200).send(fileBuffer);
  } catch (error) {
    console.error('File serving error:', error);
    return res.status(500).json({ error: 'Failed to serve file' });
  }
}

// Disable body parser and increase response limit for file serving
export const config = {
  api: {
    bodyParser: false,
    responseLimit: '50mb',
  },
};
