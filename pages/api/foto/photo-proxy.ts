/**
 * GET /api/foto/photo-proxy?url={photo_url}
 * Proxy photos from BOSS VPS to bypass CORS
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { withAuth } from '@/lib/auth';
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

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    // Send image
    res.send(Buffer.from(imageBuffer));
  } catch (error) {
    console.error('Error proxying photo:', error);
    return res.status(500).json({
      error: 'Failed to proxy photo',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export default withAuth(handler);
