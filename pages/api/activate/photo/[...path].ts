/**
 * API Route: /api/activate/photo/[drNumber]/[filename]
 *
 * Purpose: Proxy photos from internal dr-photo-api to external clients
 * Method: GET
 *
 * This solves the issue where the browser can't access http://100.96.203.105:8003
 * from https://vf.fibreflow.app (LAN IP + mixed content blocking)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';

// Internal dr-photo-api endpoint (accessible from server only)
const INTERNAL_PHOTO_API = process.env.DR_PHOTO_API_URL || 'http://100.96.203.105:8003';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end('Method Not Allowed');
  }

  try {
    const { path } = req.query;

    if (!path || !Array.isArray(path) || path.length < 2) {
      return res.status(400).json({ error: 'Invalid path. Expected /photo/[drNumber]/[filename]' });
    }

    const [drNumber, filename] = path;

    // Validate DR number format
    if (!drNumber.match(/^DR\d+$/i)) {
      return res.status(400).json({ error: 'Invalid DR number format' });
    }

    // Validate filename (prevent path traversal)
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    // Fetch from internal API
    const internalUrl = `${INTERNAL_PHOTO_API}/api/photo/${drNumber}/${filename}`;
    log.info(`[PhotoProxy] Fetching: ${internalUrl}`);

    const response = await fetch(internalUrl);

    if (!response.ok) {
      log.warn(`[PhotoProxy] Internal API returned ${response.status} for ${drNumber}/${filename}`);
      return res.status(response.status).json({
        error: `Photo not found: ${response.status}`,
      });
    }

    // Get content type and set headers
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const contentLength = response.headers.get('content-length');

    res.setHeader('Content-Type', contentType);
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    // Cache for 1 hour (photos don't change frequently)
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');

    // Stream the image to the client
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return res.status(200).send(buffer);
  } catch (error) {
    log.error('[PhotoProxy] Error proxying photo:', error);
    return res.status(500).json({ error: 'Failed to fetch photo' });
  }
}

// Disable body parsing for this route (we're dealing with binary data)
export const config = {
  api: {
    responseLimit: '10mb',
  },
};
