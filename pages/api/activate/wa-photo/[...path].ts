/**
 * API: /api/activate/wa-photo/[...path]
 * Proxy WhatsApp photos from VPS storage
 *
 * GET /api/activate/wa-photo/{group_jid}/{filename}
 * Serves photos stored at /opt/whatsapp-bridge/store/{group_jid}/{filename} on VPS
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

// VPS server where WA bridge stores photos
const VPS_HOST = '72.61.197.178';
const VPS_PHOTO_PORT = 8084; // nginx serving /opt/whatsapp-bridge/store/

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { path } = req.query;

  if (!path || !Array.isArray(path) || path.length < 2) {
    return res.status(400).json({ error: 'Invalid path. Expected: /wa-photo/{group_jid}/{filename}' });
  }

  const [groupJid, filename] = path;

  // Security: Validate path components to prevent directory traversal
  if (filename.includes('..') || filename.includes('/') || groupJid.includes('..') || groupJid.includes('/')) {
    log.warn(`Rejected path traversal attempt: ${groupJid}/${filename}`);
    return res.status(400).json({ error: 'Invalid path components' });
  }

  // Validate filename format (should be like DR1234567_20260124_123456_1.jpg)
  if (!filename.match(/^DR\d+_\d{8}_\d{6}_\d+\.(jpg|jpeg|png|webp)$/i)) {
    log.warn(`Rejected invalid filename: ${filename}`);
    return res.status(400).json({ error: 'Invalid filename format' });
  }

  try {
    // Fetch from VPS nginx serving /opt/whatsapp-bridge/store/
    const vpsUrl = `http://${VPS_HOST}:${VPS_PHOTO_PORT}/wa-photos/${groupJid}/${filename}`;

    log.info(`Proxying WA photo from VPS: ${groupJid}/${filename}`);

    const response = await fetch(vpsUrl, {
      headers: {
        'Accept': 'image/*',
      },
    });

    if (!response.ok) {
      log.error(`Photo not found on VPS: ${groupJid}/${filename} (${response.status})`);
      return res.status(404).json({ error: 'Photo not found' });
    }

    // Return the proxied image
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (error) {
    log.error(`Error proxying WA photo ${groupJid}/${filename}:`, error);
    return res.status(500).json({ error: 'Failed to fetch photo' });
  }
}

export default withAuth(handler);
