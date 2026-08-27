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
import { withAuth, withPermission } from '@/lib/auth/middleware';
import path from 'path';
import fs from 'fs';
import { apiResponse } from '@/lib/apiResponse';
import { isVlmProxyAuthorized, secretsMatch } from '@/lib/vlm/photoProxyAuth';
import { QFIELD_KEY_DENYLIST } from '@/lib/construction-qa/qfieldKeyGuard';
import { streamMinioObject, resolveLatestVersion, PHOTO_CONTENT_TYPES } from '@/lib/construction-qa/minioPhotoStream';

const STORAGE_ROOT = process.env.QA_PHOTO_STORAGE || '/home/velo/storage/qa-photos';

// SharePoint Graph API config (credentials from .env)
const SP_TENANT_ID = process.env.SP_TENANT_ID || 'f22e6344-a35d-43b0-ad8c-a247f513c1ee';
const SP_CLIENT_ID = process.env.SP_CLIENT_ID || '075bd672-bffa-45ba-9fd0-724535e612db';
const SP_CLIENT_SECRET = process.env.SP_CLIENT_SECRET || '';

// Token cache (tokens last ~3600s, cache for 3000s)
let spTokenCache: { token: string; expiresAt: number } | null = null;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { key, source = 'qfield' } = req.query;

  if (!key || typeof key !== 'string') {
    return apiResponse.badRequest(res, 'Photo key parameter required');
  }

  try {
    if (source === 'qfield') {
      // See QFIELD_KEY_DENYLIST for why parentheses/spaces are allowed.
      if (QFIELD_KEY_DENYLIST.test(key)) {
        return apiResponse.badRequest(res, 'Invalid characters in photo key');
      }
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

    return apiResponse.badRequest(res, `Unsupported photo source: ${source}`);
  } catch (error) {
    log.error('Proxy error', { module: 'cqa-photo-proxy', error: (error as Error).message, source, key }, 'cqa-photo-proxy');
    return apiResponse.internalError(res, new Error('Failed to proxy photo'));
  }
}

// Allow cron secret OR localhost (VLM server) OR session auth
function authWrapper(req: NextApiRequest, res: NextApiResponse) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  const expectedSecret = process.env.CRON_SECRET;
  if (expectedSecret && typeof cronSecret === 'string' && secretsMatch(cronSecret, expectedSecret)) {
    return handler(req, res);
  }

  // Internal VLM / loopback photo fetch: authorised by a shared secret in the
  // query string (vLLM does a plain GET and can't send a header). The old
  // peer-IP "localhost" check is gone — nginx reverse-proxies to Node over
  // loopback, so every request's remoteAddress is 127.0.0.1 and the check was
  // no boundary at all (see project_photo_proxy_vlm_auth_bypass).
  if (isVlmProxyAuthorized(req.query as { vlm?: string | string[]; vlmkey?: string | string[] })) {
    return handler(req, res);
  }
  if (req.query.vlm === 'true' && !process.env.VLM_PROXY_SECRET) {
    log.warn('photo-proxy: vlm=true request but VLM_PROXY_SECRET is not configured — denying and falling back to session auth', { module: 'cqa-photo-proxy' });
  }

  return withAuth(withPermission('construction-qa.qa-centre')(handler))(req, res);
}

export default authWrapper;

async function proxyMinioPhoto(key: string, res: NextApiResponse): Promise<void> {
  const objectPath = key.startsWith('/') ? key.slice(1) : key;

  // Try the exact path first, then resolve latest version for unversioned keys
  const pathsToTry = [objectPath];

  // If key looks unversioned (no /v2 suffix), try resolving the latest version
  if (!objectPath.includes('/v2')) {
    const resolved = await resolveLatestVersion(objectPath);
    if (resolved) {
      pathsToTry.unshift(resolved); // Try resolved version first
    }
  }

  for (const tryPath of pathsToTry) {
    const outcome = await streamMinioObject(tryPath, res);
    if (outcome === 'served') return;
    if (outcome === 'unavailable') {
      res.status(503).json({ error: 'Photo proxy only available on staging/production server' });
      return;
    }
    // 'not-found' — try the next candidate path
  }

  res.setHeader('Cache-Control', 'no-cache, max-age=0');
  res.status(404).json({ error: 'Photo not found in storage — may be awaiting QField sync', key: objectPath });
}

/**
 * Serve a photo from shared local storage (/home/velo/storage/qa-photos/).
 * storage_key format: relative path e.g. "thembisa-pop-1/TEM.P.A001/photo.jpg"
 */
async function proxyStoragePhoto(storageKey: string, res: NextApiResponse): Promise<void> {
  const normalized = path.normalize(storageKey).replace(/^(\.\.[/\\])+/, '');
  if (normalized.includes('..') || normalized.startsWith('/')) {
    apiResponse.badRequest(res, 'Invalid storage key');
    return;
  }

  const filePath = path.join(STORAGE_ROOT, normalized);
  if (!fs.existsSync(filePath)) {
    res.setHeader('Cache-Control', 'no-cache, max-age=0');
    res.status(404).json({ error: 'Photo not found in storage', key: storageKey });
    return;
  }

  const ext = path.extname(filePath).toLowerCase().slice(1);

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', PHOTO_CONTENT_TYPES[ext] || 'image/jpeg');
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
    apiResponse.badRequest(res, 'Invalid local storage key');
    return;
  }

  const filePath = path.join(process.cwd(), 'public', 'uploads', normalized);
  if (!fs.existsSync(filePath)) {
    res.setHeader('Cache-Control', 'no-cache, max-age=0');
    res.status(404).json({ error: 'Local photo not found', key: storageKey });
    return;
  }

  const ext = path.extname(filePath).toLowerCase().slice(1);

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', PHOTO_CONTENT_TYPES[ext] || 'image/jpeg');
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
  if (!SP_CLIENT_SECRET) {
    res.status(503).json({ error: 'SharePoint credentials not configured' });
    return;
  }

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
