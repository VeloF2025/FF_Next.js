/**
 * Maintenance WhatsApp Photos API
 *
 * Serves photos from VPS storage for maintenance tracking.
 * URL: /api/maintenance/wa-photos/{group_jid}/{filename}
 *
 * The photos are stored on VPS at /opt/whatsapp-bridge/store/{group_jid}/{filename}
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';

const logger = createLogger('maintenance:wa-photos');

// VPS configuration
const VPS_HOST = process.env.VPS_HOST || '72.61.197.178';
const VPS_PHOTO_BASE = '/opt/whatsapp-bridge/store';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { path } = req.query;

    if (!path || !Array.isArray(path) || path.length < 2) {
      return res.status(400).json({ error: 'Invalid path. Expected: /group_jid/filename' });
    }

    const [groupJid, filename] = path;

    if (!groupJid || !filename) {
      return res.status(400).json({ error: 'Invalid path. Expected: /group_jid/filename' });
    }

    // Validate filename to prevent directory traversal
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    // Fetch photo from VPS via SSH/SCP or HTTP proxy
    // For now, we'll proxy through an nginx endpoint on VPS
    const vpsUrl = `http://${VPS_HOST}:8084/photos/${groupJid}/${filename}`;

    logger.info({ groupJid, filename }, 'Fetching maintenance photo from VPS');

    const response = await fetch(vpsUrl);

    if (!response.ok) {
      logger.error({ status: response.status, groupJid, filename }, 'Failed to fetch photo from VPS');
      return res.status(404).json({ error: 'Photo not found' });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
    res.send(Buffer.from(buffer));
  } catch (error) {
    logger.error({ error }, 'Error serving maintenance photo');
    return res.status(500).json({ error: 'Failed to fetch photo' });
  }
}
