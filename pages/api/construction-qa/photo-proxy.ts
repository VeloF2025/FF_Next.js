/**
 * GET /api/construction-qa/photo-proxy?key={storage_key}&source={source}
 *
 * Proxies construction QA photos from multiple storage backends:
 *   - qfield: MinIO via docker exec mc cat
 *   - sharepoint: MS Graph API with client-credentials token
 *   - upload: Local filesystem or VF server
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'qfieldcloud-prod';
const STORAGE_ROOT = process.env.QA_PHOTO_STORAGE || '/home/velo/storage/qa-photos';

// SharePoint Graph API config
const SP_TENANT_ID = 'f22e6344-a35d-43b0-ad8c-a247f513c1ee';
const SP_CLIENT_ID = '075bd672-bffa-45ba-9fd0-724535e612db';
const SP_CLIENT_SECRET = 'Ozw8Q~HG1PMZFPNb0Ze1f-eTYrtglVioRzy2lakF';

// Token cache (tokens last ~3600s, cache for 3000s)
let spTokenCache: { token: string; expiresAt: number } | null = null;

async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    if (source === 'sharepoint') {
      return await proxySharePointPhoto(key, res);
    }

    if (source === 'upload') {
      return await proxyLocalPhoto(key, res);
    }

    if (source === 'local') {
      return await proxyStoragePhoto(key, res);
    }

    return res.status(400).json({ error: `Unsupported photo source: ${source}` });
  } catch (error) {
    log.error('Proxy error', { module: 'cqa-photo-proxy', error: (error as Error).message, source, key }, 'cqa-photo-proxy');
    return res.status(500).json({ error: 'Failed to proxy photo' });
  }
}

export default withAuth(withPermission('construction-qa.qa-centre')(handler));

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

/**
 * Serve a photo from shared local storage (/home/velo/storage/qa-photos/).
 * storage_key format: relative path e.g. "thembisa-pop-1/TEM.P.A001/photo.jpg"
 */
async function proxyStoragePhoto(storageKey: string, res: NextApiResponse): Promise<void> {
  const normalized = path.normalize(storageKey).replace(/^(\.\.[/\\])+/, '');
  if (normalized.includes('..') || normalized.startsWith('/')) {
    res.status(400).json({ error: 'Invalid storage key' });
    return;
  }

  const filePath = path.join(STORAGE_ROOT, normalized);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Photo not found in storage', key: storageKey });
    return;
  }

  const ext = path.extname(filePath).toLowerCase().slice(1);
  const contentTypes: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
  };

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', contentTypes[ext] || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  res.setHeader('Content-Length', stat.size);

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
}

/**
 * Serve a photo from local uploads directory.
 * storage_key format: relative path under public/uploads/ e.g. "qa-photos/thembisa-pop-1/TEM.P.A001/photo.jpg"
 */
async function proxyLocalPhoto(storageKey: string, res: NextApiResponse): Promise<void> {
  // Prevent path traversal
  const normalized = path.normalize(storageKey).replace(/^(\.\.[/\\])+/, '');
  if (normalized.includes('..') || normalized.startsWith('/')) {
    res.status(400).json({ error: 'Invalid local storage key' });
    return;
  }

  const filePath = path.join(process.cwd(), 'public', 'uploads', normalized);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Local photo not found', key: storageKey });
    return;
  }

  const ext = path.extname(filePath).toLowerCase().slice(1);
  const contentTypes: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
  };

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', contentTypes[ext] || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  res.setHeader('Content-Length', stat.size);

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
}

/**
 * Proxy a photo from SharePoint via MS Graph API.
 * storage_key format: "sharepoint:{driveId}:{itemId}"
 */
async function proxySharePointPhoto(storageKey: string, res: NextApiResponse): Promise<void> {
  // Parse key: "sharepoint:{driveId}:{itemId}"
  const parts = storageKey.split(':');
  if (parts.length < 3 || parts[0] !== 'sharepoint') {
    res.status(400).json({ error: 'Invalid SharePoint storage key format', key: storageKey });
    return;
  }
  const driveId = parts[1];
  const itemId = parts.slice(2).join(':'); // item IDs don't contain colons, but be safe

  const token = await getSharePointToken();

  const graphUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`;
  const graphRes = await fetch(graphUrl, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'follow',
  });

  if (!graphRes.ok) {
    if (graphRes.status === 404) {
      res.status(404).json({ error: 'SharePoint photo not found', key: storageKey });
      return;
    }
    const errText = await graphRes.text().catch(() => '');
    log.error('SharePoint proxy error', {
      module: 'cqa-photo-proxy',
      status: graphRes.status,
      error: errText.slice(0, 200),
    }, 'cqa-photo-proxy');
    res.status(502).json({ error: `SharePoint returned ${graphRes.status}` });
    return;
  }

  const contentType = graphRes.headers.get('content-type') || 'image/jpeg';
  const contentLength = graphRes.headers.get('content-length');

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  if (contentLength) res.setHeader('Content-Length', contentLength);

  // Stream the response body
  const arrayBuffer = await graphRes.arrayBuffer();
  res.send(Buffer.from(arrayBuffer));
}

/** Get a cached MS Graph API token for SharePoint access. */
async function getSharePointToken(): Promise<string> {
  if (spTokenCache && Date.now() < spTokenCache.expiresAt) {
    return spTokenCache.token;
  }

  const tokenUrl = `https://login.microsoftonline.com/${SP_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: SP_CLIENT_ID,
    client_secret: SP_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!tokenRes.ok) {
    throw new Error(`SharePoint token request failed: ${tokenRes.status}`);
  }

  const data = await tokenRes.json();
  const token = data.access_token;
  // Cache for 50 minutes (tokens last 60 min)
  spTokenCache = { token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return token;
}
