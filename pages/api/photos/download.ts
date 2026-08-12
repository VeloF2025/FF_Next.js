/**
 * GET /api/photos/download?key=&source=&uid=&exp=&sig= — one photo, by signed link.
 *
 * Authorised by SIGNATURE ONLY, deliberately: the caller is Claude's Cowork sandbox,
 * which holds no FibreFlow session and cannot be given one. RBAC was evaluated when
 * /api/photos/manifest minted this link for an authenticated user; the signature is
 * that decision, made portable and time-boxed.
 *
 * The signature covers the photo key, so a leaked link opens exactly one photo and
 * cannot be edited into another.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { isConfigured, verifyLink } from '@/lib/photos/photoLinks';
import { vlmProxyKeyParam } from '@/lib/vlm/photoProxyAuth';

// Photos run past Next's ~4 MB API response cap — an 8.9 MB original was measured in the
// QA store — so the cap is lifted here rather than truncating a download into a corrupt file.
export const config = { api: { responseLimit: false } };

const LOOPBACK_BASE = `http://127.0.0.1:${process.env.PORT ?? '3000'}`;
const FETCH_TIMEOUT_MS = 30_000;

/** Guard the value that reaches photo-proxy's `docker exec` path. Mirrors its own check. */
const UNSAFE_KEY = /[;`$|&\\(){}[\]!#]/;

function safeFilename(key: string): string {
  const base = key.split('/').filter(Boolean).slice(-2).join('_');
  return (base || 'photo.jpg').replace(/[^A-Za-z0-9._-]/g, '_');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }
  if (!isConfigured()) {
    return apiResponse.internalError(
      res,
      new Error('Photo download links are not configured on this server.'),
    );
  }

  const { key, source, uid, exp, sig } = req.query as Record<string, string>;
  if (!key || !source || !uid) return apiResponse.badRequest(res, 'Incomplete download link.');
  if (UNSAFE_KEY.test(key)) return apiResponse.badRequest(res, 'Invalid characters in photo key.');
  if (key.includes('..')) return apiResponse.badRequest(res, 'Invalid photo key.');

  const verdict = verifyLink({ key, source, uid }, exp, sig);
  if (verdict !== 'ok') {
    return apiResponse.unauthorized(
      res,
      verdict === 'expired'
        ? 'This download link has expired. Ask FibreFlow for a fresh manifest.'
        : 'Invalid download link.',
    );
  }

  const upstream =
    `${LOOPBACK_BASE}/api/construction-qa/photo-proxy` +
    `?key=${encodeURIComponent(key)}&source=${encodeURIComponent(source)}${vlmProxyKeyParam()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const upstreamRes = await fetch(upstream, { signal: controller.signal });
    if (!upstreamRes.ok) {
      // apiResponse.internalError sanitises the body, so the diagnosis has to go to the
      // log or it goes nowhere. 401 here is the one worth naming: it means the internal
      // call fell through to session auth, i.e. VLM_PROXY_SECRET is unset on this host —
      // a config fault that looks identical to a bad link from the outside.
      log.warn(
        'Photo download upstream failed',
        {
          module: 'photos-download',
          status: upstreamRes.status,
          key,
          userId: uid,
          diagnosis:
            upstreamRes.status === 401
              ? 'photo-proxy rejected the internal call — VLM_PROXY_SECRET is probably unset'
              : 'photo-proxy returned an unexpected status',
        },
        'photos-download',
      );
      return apiResponse.internalError(res, new Error('Could not fetch that photo'));
    }

    const body = Buffer.from(await upstreamRes.arrayBuffer());
    res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Content-Length', body.length);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(key)}"`);
    // A signed link is a credential; a shared cache must never keep what it fetched.
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(body);
  } catch (error) {
    log.error(
      'Photo download failed',
      { module: 'photos-download', error: (error as Error).message, key, userId: uid },
      'photos-download',
    );
    return apiResponse.internalError(res, new Error('Photo download failed'));
  } finally {
    clearTimeout(timer);
  }
}
