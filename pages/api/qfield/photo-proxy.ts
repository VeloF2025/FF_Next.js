/**
 * GET /api/qfield/photo-proxy?key={photo_key}
 * Proxy photos from MinIO (QFieldCloud storage) to frontend
 *
 * Fetches photos from the qfieldcloud-prod bucket on Velocity (100.96.203.105)
 * and serves them to the frontend with proper caching headers.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

// MinIO configuration
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'http://100.96.203.105:9000';
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || '';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || '';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'qfieldcloud-prod';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { key } = req.query;

  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'Photo key parameter required' });
  }

  try {
    // Construct MinIO URL
    // Key format: projects/{project_id}/DCIM/{filename}
    const objectPath = key.startsWith('/') ? key.slice(1) : key;
    const minioUrl = `${MINIO_ENDPOINT}/${MINIO_BUCKET}/${objectPath}`;

    log.debug('qfield-photo-proxy', { key: objectPath, url: minioUrl }, 'Fetching photo');

    // Fetch from MinIO with authentication
    const response = await fetch(minioUrl, {
      headers: {
        // If MinIO requires auth, we'd add signature here
        // For now, assuming public read access or pre-signed URLs
      },
    });

    if (!response.ok) {
      log.error('qfield-photo-proxy', { key: objectPath, status: response.status }, 'MinIO fetch failed');
      return res.status(response.status).json({
        error: `Failed to fetch photo: ${response.statusText}`,
      });
    }

    // Get image data
    const imageBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    // Set headers for caching and CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');

    // Send image
    res.send(Buffer.from(imageBuffer));
  } catch (error) {
    log.error('qfield-photo-proxy', error instanceof Error ? { message: error.message } : { error }, 'Proxy error');
    return res.status(500).json({
      error: 'Failed to proxy photo',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export default withAuth(handler);
