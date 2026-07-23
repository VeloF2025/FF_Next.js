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
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import path from 'path';
import fs from 'fs';
import { apiResponse } from '@/lib/apiResponse';
import { isVlmProxyAuthorized, secretsMatch } from '@/lib/vlm/photoProxyAuth';

const execFileAsync = promisify(execFile);
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'qfieldcloud-prod';
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
      // Guard against shell injection — key is passed to docker exec
      if (/[;`$|&\\(){}\[\]!#]/.test(key)) {
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

const MINIO_CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
};

/** Bytes needed before deciding whether stdout is object data or an `mc` diagnostic. */
const MC_PROBE_BYTES = 4;

type MinioOutcome = 'served' | 'not-found' | 'unavailable';

/**
 * Pipe one MinIO object straight to the response.
 *
 * The photo is streamed rather than buffered. The previous implementation used
 * exec() with `maxBuffer: 50MB`, holding every in-flight image fully in memory;
 * under gallery load that drove the production heap past 12GB and caused
 * multi-hundred-millisecond GC stalls across all routes.
 *
 * Uses spawn() with an argv array (no shell), so the object path cannot be
 * interpreted as shell syntax. stderr is kept separate from stdout so `mc`
 * diagnostics can never be mistaken for image bytes.
 */
function streamMinioObject(tryPath: string, res: NextApiResponse): Promise<MinioOutcome> {
  return new Promise((resolve) => {
    const mcPath = `local/${MINIO_BUCKET}/${tryPath}`;
    const child = spawn('docker', ['exec', 'qfieldcloud-minio-1', 'mc', 'cat', mcPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let probe: Buffer = Buffer.alloc(0);
    let streaming = false;
    let settled = false;
    let stderr = '';

    const kill = () => { if (!child.killed) child.kill('SIGKILL'); };
    const onClientGone = () => kill();
    res.on('close', onClientGone);

    const settle = (outcome: MinioOutcome) => {
      if (settled) return;
      settled = true;
      res.off('close', onClientGone);
      resolve(outcome);
    };

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 2048) stderr += chunk.toString('utf-8');
    });

    // Begin piping once we've seen enough bytes to rule out an `mc` diagnostic.
    const beginStream = () => {
      streaming = true;
      const ext = tryPath.split('.').pop()?.toLowerCase() || 'jpg';
      res.setHeader('Content-Type', MINIO_CONTENT_TYPES[ext] || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      res.write(probe);
      child.stdout.pipe(res);
      settle('served');
    };

    const onProbe = (chunk: Buffer) => {
      probe = Buffer.concat([probe, chunk]);
      if (probe.length < MC_PROBE_BYTES) return;
      child.stdout.removeListener('data', onProbe);
      child.stdout.pause();
      if (probe.subarray(0, 3).toString('ascii') === 'mc:') {
        kill();
        settle('not-found');
        return;
      }
      beginStream();
    };

    child.stdout.on('data', onProbe);

    // stdout ended before the probe threshold: empty object, or a stub too small to be a photo.
    child.stdout.on('end', () => {
      if (streaming || settled) return;
      child.stdout.removeListener('data', onProbe);
      if (probe.length > 0 && probe.subarray(0, 3).toString('ascii') !== 'mc:') {
        beginStream();
        return;
      }
      settle('not-found');
    });

    child.on('error', (err) => {
      log.error('construction-qa-photo-proxy: docker spawn failed', {
        module: 'cqa-photo-proxy', error: err.message, path: tryPath,
      });
      settle('unavailable');
    });

    child.on('close', () => {
      if (settled) return;
      if (/Cannot connect to the Docker daemon|No such container/.test(stderr)) {
        settle('unavailable');
        return;
      }
      if (stderr.trim()) {
        log.error('construction-qa-photo-proxy: mc cat failed', {
          module: 'cqa-photo-proxy', error: stderr.trim().slice(0, 300), path: tryPath,
        });
      }
      settle('not-found');
    });
  });
}

/** Resolve an unversioned MinIO key to its latest version. */
async function resolveLatestVersion(objectPath: string): Promise<string | null> {
  try {
    const mcPath = `local/${MINIO_BUCKET}/${objectPath}/`;
    // execFile with an argv array — no shell, so the key cannot be interpreted
    // as shell syntax (the listing is small, so buffering it is fine here).
    const { stdout } = await execFileAsync(
      'docker',
      ['exec', 'qfieldcloud-minio-1', 'mc', 'ls', mcPath],
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
    );

    if (!stdout || !stdout.trim()) return null;

    const lines = stdout.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return null;

    // Last line has latest version: "... v20260310120500-7bc5005f"
    const parts = lines[lines.length - 1]!.trim().split(/\s+/);
    const version = parts[parts.length - 1]!.replace(/\/$/, '');
    if (!version.startsWith('v2')) return null;

    return `${objectPath}/${version}`;
  } catch {
    return null;
  }
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
