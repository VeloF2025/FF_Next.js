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

// VPS photo viewer endpoint (serves /var/lib/docker/volumes/boss-vps_dr_photos/_data/)
const VPS_PHOTO_API = process.env.VPS_PHOTO_URL || 'http://72.61.197.178:8866';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { path } = req.query;

  if (!path || !Array.isArray(path) || path.length < 2) {
    return res.status(400).json({ error: 'Invalid path. Expected: /wa-photo/{drNumber}/{filename}' });
  }

  const [drNumber, filename] = path;

  // Security: Validate path components to prevent directory traversal
  if (filename.includes('..') || filename.includes('/') || drNumber.includes('..') || drNumber.includes('/')) {
    log.warn(`[WaPhotoProxy] Rejected path traversal attempt: ${drNumber}/${filename}`);
    return res.status(400).json({ error: 'Invalid path components' });
  }

  // Validate DR number format
  if (!drNumber.match(/^DR\d+$/i)) {
    return res.status(400).json({ error: 'Invalid DR number format' });
  }

  // Validate filename format - accepts both:
  // - WA photos: wa_DR1234567_20260124_143756_1.jpg
  // - Regular photos: DR1234567_ph_*.jpg
  const validFilename = filename.match(/^(wa_)?DR\d+[_\w]+\.(jpg|jpeg|png|webp)$/i);
  if (!validFilename) {
    log.warn(`[WaPhotoProxy] Rejected invalid filename: ${filename}`);
    return res.status(400).json({ error: 'Invalid filename format' });
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
      return res.status(404).json({ error: 'Photo not found' });
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
    return res.status(500).json({ error: 'Failed to fetch photo' });
  }
}

export default withAuth(handler);
