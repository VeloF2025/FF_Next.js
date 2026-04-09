/**
 * API Route: /api/activate/photo/[drNumber]/[filename]
 *
 * Purpose: Proxy photos from backend servers to external clients
 * Method: GET
 *
 * This solves mixed content blocking / CORS issues when browsers can't access
 * internal photo servers directly from https://dev.fibreflow.app
 *
 * Routing logic based on filename:
 * - WA photos (wa_*) → VPS:8866 /photos/{DR}/{filename}
 * - 1Map photos → Velocity:8003 /api/photo/{DR}/{filename}
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';

// Photo server endpoints
const VPS_PHOTO_API = process.env.VPS_PHOTO_URL || 'http://72.61.197.178:8866';
const VELOCITY_PHOTO_API = process.env.VELOCITY_PHOTO_URL || 'http://100.96.203.105:8003';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { path } = req.query;

    if (!path || !Array.isArray(path) || path.length < 2) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid parameters');
    }

    const drNumber = path[0]!;
    const filename = path[1]!;

    // Validate DR number format
    if (!drNumber.match(/^DR\d+$/i)) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid parameters');
    }

    // Validate filename (prevent path traversal)
    if (filename.includes('..') || filename.includes('/')) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid parameters');
    }

    // Route based on filename pattern:
    // - WA photos (wa_*) → VPS photo viewer
    // - 1Map photos → Velocity photo server
    const isWaPhoto = filename.toLowerCase().startsWith('wa_');

    let photoUrl: string;
    if (isWaPhoto) {
      // WA photos stored on VPS: /var/lib/docker/volumes/boss-vps_dr_photos/_data/{DR}/{filename}
      photoUrl = `${VPS_PHOTO_API}/photos/${drNumber}/${filename}`;
    } else {
      // 1Map photos served by Velocity photo server
      photoUrl = `${VELOCITY_PHOTO_API}/api/photo/${drNumber}/${filename}`;
    }

    log.info(`[PhotoProxy] Fetching ${isWaPhoto ? 'WA' : '1Map'} photo: ${photoUrl}`);

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
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);

// Disable body parsing for this route (we're dealing with binary data)
export const config = {
  api: {
    responseLimit: '10mb',
  },
};
