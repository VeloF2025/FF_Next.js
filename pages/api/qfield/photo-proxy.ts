/**
 * GET /api/qfield/photo-proxy?key={photo_key}
 * Proxy photos from MinIO (QFieldCloud storage) to frontend
 *
 * Uses the mc (MinIO Client) inside the Docker container to fetch files
 * via the S3 API. This handles MinIO's erasure-coded storage correctly.
 *
 * NOTE: Only works on Velocity server where Docker containers are running.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import { apiResponse } from '@/lib/apiResponse';

const execAsync = promisify(exec);

const MINIO_BUCKET = process.env.MINIO_BUCKET || 'qfieldcloud-prod';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { key } = req.query;

  if (!key || typeof key !== 'string') {
    return apiResponse.badRequest(res, 'Photo key parameter required');
  }

  // Validate path to prevent shell injection via docker exec
  if (/[;`$|&\\(){}\[\]!#]/.test(key)) {
    return apiResponse.badRequest(res, 'Invalid characters in photo key');
  }

  try {
    // Key format: projects/{project_id}/files/DCIM/{filename}/{version}
    const objectPath = key.startsWith('/') ? key.slice(1) : key;

    log.debug('qfield-photo-proxy', { key: objectPath }, 'Fetching photo via mc client');

    // Use mc cat to fetch file through S3 API - handles erasure coding properly
    // The 'local' alias is pre-configured in the MinIO container
    const mcPath = `local/${MINIO_BUCKET}/${objectPath}`;

    // Escape single quotes in path for shell safety
    const escapedPath = mcPath.replace(/'/g, "'\\''");
    const command = `docker exec qfieldcloud-minio-1 mc cat '${escapedPath}' 2>&1`;

    try {
      const { stdout } = await execAsync(command, {
        encoding: 'buffer',
        maxBuffer: 50 * 1024 * 1024, // 50MB max for photos
      });

      if (!stdout || stdout.length === 0) {
        log.warn('qfield-photo-proxy', { key: objectPath }, 'Empty file returned');
        return res.status(404).json({
          error: 'Photo not found or empty',
          key: objectPath,
        });
      }

      // Check if output contains error message instead of binary data
      // mc errors start with "mc:" and contain text like "ERROR" or "does not exist"
      const firstBytes = stdout.slice(0, 100).toString('utf-8');
      if (firstBytes.startsWith('mc:') || firstBytes.includes('ERROR') || firstBytes.includes('does not exist')) {
        log.warn('qfield-photo-proxy', { key: objectPath, error: firstBytes }, 'mc returned error');
        return res.status(404).json({
          error: 'Photo not found',
          key: objectPath,
          details: firstBytes.slice(0, 200),
        });
      }

      // Verify it looks like image data (check magic bytes)
      // JPEG: ff d8 ff, PNG: 89 50 4e 47
      const isJpeg = stdout[0] === 0xff && stdout[1] === 0xd8 && stdout[2] === 0xff;
      const isPng = stdout[0] === 0x89 && stdout[1] === 0x50 && stdout[2] === 0x4e && stdout[3] === 0x47;
      if (!isJpeg && !isPng && stdout.length < 1000) {
        // Small non-image response is likely an error
        const text = stdout.toString('utf-8').slice(0, 200);
        log.warn('qfield-photo-proxy', { key: objectPath, text }, 'Response does not appear to be image data');
        return res.status(404).json({
          error: 'Invalid image data',
          key: objectPath,
        });
      }

      // Determine content type from extension
      const ext = objectPath.split('.').pop()?.toLowerCase() || 'jpg';
      const contentTypes: Record<string, string> = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'heic': 'image/heic',
      };
      const contentType = contentTypes[ext] || 'image/jpeg';

      // Set headers for caching
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      res.setHeader('Content-Length', stdout.length);

      // Send image
      res.send(stdout);
    } catch (execError) {
      log.error('qfield-photo-proxy', { error: execError instanceof Error ? execError.message : String(execError) });
      const error = execError as { stderr?: string; message?: string; code?: number };
      const errorMsg = error.stderr || error.message || '';

      // Check if it's a "file not found" error from mc
      if (errorMsg.includes('Object does not exist') ||
          errorMsg.includes('does not exist') ||
          errorMsg.includes('not found') ||
          errorMsg.includes('404')) {
        log.warn('qfield-photo-proxy', { key: objectPath, error: errorMsg.slice(0, 200) }, 'Photo not found in MinIO');
        return res.status(404).json({
          error: 'Photo not found',
          key: objectPath,
        });
      }

      // Check if Docker is not available (not on Velocity server)
      if (errorMsg.includes('Cannot connect to the Docker daemon') ||
          errorMsg.includes('command not found') ||
          errorMsg.includes('No such container') ||
          errorMsg.includes('permission denied')) {
        log.error('qfield-photo-proxy', { key: objectPath, error: errorMsg.slice(0, 200) }, 'Docker not available');
        return res.status(503).json({
          error: 'Photo proxy only available on staging/production server',
          key: objectPath,
        });
      }

      throw execError;
    }
  } catch (error) {
    log.error('qfield-photo-proxy', error instanceof Error ? { message: error.message } : { error }, 'Proxy error');
    return res.status(500).json({
      error: 'Failed to proxy photo',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export default withAuth(handler);
