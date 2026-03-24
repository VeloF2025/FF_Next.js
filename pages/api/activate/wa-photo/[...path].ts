/**
 * API: /api/activate/wa-photo/[...path]
 * Proxy WhatsApp photos from VPS storage
 *
 * GET /api/activate/wa-photo/{drNumber}/{filename}
 * Serves photos stored at /var/lib/docker/volumes/boss-vps_dr_photos/_data/{DR}/{filename}
 *
 * Note: This endpoint mirrors /api/activate/photo/[...path].ts for WA-specific photos
 * Both endpoints now point to the same VPS photo viewer (port 8866)
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';

// VPS photo viewer endpoint (serves /var/lib/docker/volumes/boss-vps_dr_photos/_data/)
const VPS_PHOTO_API = process.env.VPS_PHOTO_URL || 'http://72.61.197.178:8866';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET','POST','PUT','DELETE','PATCH']);
  }

  const { path } = req.query;

  if (!path || !Array.isArray(path) || path.length < 2) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Invalid path. Expected: /wa-photo/{drNumber}/{filename}');
  }

  const [drNumber, filename] = path;

  // Security: Validate path components to prevent directory traversal
  if (filename.includes('..') || filename.includes('/') || drNumber.includes('..') || drNumber.includes('/')) {
    log.warn(`[WaPhotoProxy] Rejected path traversal attempt: ${drNumber}/${filename}`);
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid parameters');
  }

  // Validate DR number format
  if (!drNumber.match(/^DR\d+$/i)) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid parameters');
  }

  // Validate filename format - accepts both:
  // - WA photos: wa_DR1234567_20260124_143756_1.jpg
  // - Regular photos: DR1234567_ph_*.jpg
  const validFilename = filename.match(/^(wa_)?DR\d+[_\w]+\.(jpg|jpeg|png|webp)$/i);
  if (!validFilename) {
    log.warn(`[WaPhotoProxy] Rejected invalid filename: ${filename}`);
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid parameters');
  }

  try {
    // Fetch from VPS photo viewer (same as /api/activate/photo/[...path].ts)
    const photoUrl = `${VPS_PHOTO_API}/photos/${drNumber}/${filename}`;

    log.info(`[WaPhotoProxy] Fetching: ${photoUrl}`);

    const response = await fetch(photoUrl, {
      headers: {
        'Accept': 'image/*',
      },
    });

    if (!response.ok) {
      log.warn(`[WaPhotoProxy] Photo not found: ${drNumber}/${filename} (${response.status})`);
      return apiResponse.error(res, ErrorCode.NOT_FOUND, 'Not found');
    }

    // Return the proxied image
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600'); // Cache for 1 hour
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (error) {
    log.error(`[WaPhotoProxy] Error proxying photo ${drNumber}/${filename}:`, error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
