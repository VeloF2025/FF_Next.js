/**
 * GET /api/foto/photo-proxy?url={photo_url}
 * Proxy photos from BOSS VPS to bypass CORS
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

// Only allow fetching from known internal hosts
const ALLOWED_HOSTS = [
  '72.61.197.178',     // VPS
  '72.60.17.245',      // Old VPS
  '100.96.203.105',    // Velocity (Tailscale)
  'localhost',
];

function isAllowedUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    return ALLOWED_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL parameter required' });
  }

  if (!isAllowedUrl(url)) {
    log.warn('foto-photo-proxy', { url }, 'Blocked request to disallowed host');
    return res.status(403).json({ error: 'URL host not allowed' });
  }

  try {
    // Fetch photo from BOSS VPS
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Failed to fetch photo: ${response.statusText}`
      });
    }

    // Get image data
    const imageBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    // Send image
    res.send(Buffer.from(imageBuffer));
  } catch (error) {
    log.error('foto-photo-proxy', error instanceof Error ? { message: error.message } : { error }, 'Error proxying photo');
    return res.status(500).json({
      error: 'Failed to proxy photo',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export default withAuth(handler);
