/**
 * API Route: /api/activate/photo/[drNumber]/[filename]
 *
 * Purpose: Proxy photos from VPS photo viewer to external clients
 * Method: GET
 *
 * This solves the issue where the browser can't access http://72.61.197.178:8866
 * from https://dev.fibreflow.app (mixed content blocking / CORS)
 *
 * Photo storage: /var/lib/docker/volumes/boss-vps_dr_photos/_data/{DR}/{filename}
 * VPS viewer URL: http://72.61.197.178:8866/photos/{DR}/{filename}
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

// VPS photo viewer endpoint (serves photos from /var/lib/docker/volumes/boss-vps_dr_photos/_data/)
const VPS_PHOTO_API = process.env.VPS_PHOTO_URL || 'http://72.61.197.178:8866';

async function handler(
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

    // Fetch from VPS photo viewer (serves /var/lib/docker/volumes/boss-vps_dr_photos/_data/)
    const photoUrl = `${VPS_PHOTO_API}/photos/${drNumber}/${filename}`;
    log.info(`[PhotoProxy] Fetching: ${photoUrl}`);

    const response = await fetch(photoUrl);

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

export default withAuth(handler);

// Disable body parsing for this route (we're dealing with binary data)
export const config = {
  api: {
    responseLimit: '10mb',
  },
};
