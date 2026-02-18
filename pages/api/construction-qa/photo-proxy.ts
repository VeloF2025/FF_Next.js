/**
 * GET /api/construction-qa/photo-proxy?key={storage_key}&source={source}
 *
 * Proxies construction QA photos from multiple storage backends:
 *   - qfield: MinIO via docker exec mc cat (same as /api/qfield/photo-proxy)
 *   - upload: Local filesystem or VF server
 *
 * SharePoint and WhatsApp sources will be added in Phase 2/3.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'qfieldcloud-prod';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { key, source = 'qfield' } = req.query;

  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'Photo key parameter required' });
  }

  try {
    if (source === 'qfield') {
      return await proxyMinioPhoto(key, res);
    }

    // Future sources: sharepoint, whatsapp, upload
    return res.status(400).json({ error: `Unsupported photo source: ${source}` });
  } catch (error) {
    log.error('Proxy error', { module: 'cqa-photo-proxy', error: (error as Error).message }, 'cqa-photo-proxy');
    return res.status(500).json({ error: 'Failed to proxy photo' });
  }
}

async function proxyMinioPhoto(key: string, res: NextApiResponse): Promise<void> {
  const objectPath = key.startsWith('/') ? key.slice(1) : key;
  const mcPath = `local/${MINIO_BUCKET}/${objectPath}`;
  const escapedPath = mcPath.replace(/'/g, "'\\''");
  const command = `docker exec qfieldcloud-minio-1 mc cat '${escapedPath}' 2>&1`;

  try {
    const { stdout } = await execAsync(command, {
      encoding: 'buffer',
      maxBuffer: 50 * 1024 * 1024,
    });

    if (!stdout || stdout.length === 0) {
      res.status(404).json({ error: 'Photo not found or empty', key: objectPath });
      return;
    }

    // Check for mc error messages
    const firstBytes = stdout.slice(0, 100).toString('utf-8');
    if (firstBytes.startsWith('mc:') || firstBytes.includes('ERROR') || firstBytes.includes('does not exist')) {
      res.status(404).json({ error: 'Photo not found', key: objectPath });
      return;
    }

    // Verify image magic bytes
    const isJpeg = stdout[0] === 0xff && stdout[1] === 0xd8 && stdout[2] === 0xff;
    const isPng = stdout[0] === 0x89 && stdout[1] === 0x50 && stdout[2] === 0x4e && stdout[3] === 0x47;
    if (!isJpeg && !isPng && stdout.length < 1000) {
      res.status(404).json({ error: 'Invalid image data', key: objectPath });
      return;
    }

    // Content type from extension
    const ext = objectPath.split('.').pop()?.toLowerCase() || 'jpg';
    const contentTypes: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
    };

    res.setHeader('Content-Type', contentTypes[ext] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('Content-Length', stdout.length);
    res.send(stdout);
  } catch (execError) {
    const err = execError as { stderr?: string; message?: string };
    const errorMsg = err.stderr || err.message || '';

    if (errorMsg.includes('does not exist') || errorMsg.includes('not found') || errorMsg.includes('404')) {
      res.status(404).json({ error: 'Photo not found', key: objectPath });
      return;
    }

    if (errorMsg.includes('Cannot connect to the Docker daemon') || errorMsg.includes('No such container')) {
      res.status(503).json({ error: 'Photo proxy only available on staging/production server' });
      return;
    }

    throw execError;
  }
}
