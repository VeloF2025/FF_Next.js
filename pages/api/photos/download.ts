/**
 * GET /api/photos/download?key=&source=&uid=&exp=&sig= — one photo, by signed link.
 *
 * Authorised by SIGNATURE ONLY, deliberately: the caller is Claude's Cowork sandbox,
 * which holds no FibreFlow session and cannot be given one. RBAC is evaluated when
 * /api/photos/manifest mints this link for an authenticated user; the signature is
 * that decision, made portable and time-boxed.
 *
 * The signature covers the photo key, so a leaked link opens exactly one photo and
 * cannot be edited into another.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { isConfigured, verifyLink } from '@/lib/photos/photoLinks';
import rateLimiter from '@/lib/rateLimiter';
import { vlmProxyKeyParam } from '@/lib/vlm/photoProxyAuth';

// Photos run past Next's ~4 MB API response cap — an 8.9 MB original was measured in the
// QA store — so the cap is lifted here rather than truncating a download into a corrupt file.
export const config = { api: { responseLimit: false } };

const LOOPBACK_BASE = `http://127.0.0.1:${process.env.PORT ?? '3000'}`;

/**
 * Bounds the loopback fetch ONLY — cleared the moment the response headers arrive.
 *
 * It must not still be armed while the body streams to the client. Aborting the
 * controller after the fetch resolves kills the in-flight body, so a timer left running
 * across the transfer truncates any download slower than this: 8.9 MB in 30s needs a
 * sustained 300 KB/s, which a sandbox pulling thousands of photos concurrently will not
 * hold. The client would get a silently truncated JPEG — and for `source=qfield`
 * upstream sends no Content-Length, so nothing downstream could even detect the cut.
 */
const FETCH_TIMEOUT_MS = 30_000;

/** Guard the value that reaches photo-proxy's storage lookup. Mirrors its own check. */
const UNSAFE_KEY = /[;`$|&\\(){}[\]!#]/;

/**
 * The only sources a minted link can carry (see proxySourceForKey). photo-proxy also
 * accepts `sharepoint` and `upload`; nothing here should be able to select those even
 * if a signature for one were ever produced.
 */
const ALLOWED_SOURCES = new Set(['local', 'qfield']);

/**
 * A signed link is unauthenticated by design, so without this one leaked URL is an
 * unmetered fetch loop against the photo store. Mirrors the public share-link limiter
 * in pages/api/snags/shared/[token].ts.
 */
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

function safeFilename(key: string): string {
  const base = key.split('/').filter(Boolean).slice(-2).join('_');
  return (base || 'photo.jpg').replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Read a query param as a single string.
 *
 * `req.query[k]` is `string | string[]`, and the array form silently changes what the
 * guards below mean: `['..', '/x'].includes('..')` is element equality, not substring,
 * so a repeated param would walk straight past the traversal check.
 */
function one(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
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

  const key = one(req.query.key);
  const source = one(req.query.source);
  const uid = one(req.query.uid);
  const { exp, sig } = req.query;

  if (!key || !source || !uid) return apiResponse.badRequest(res, 'Incomplete download link.');
  if (!ALLOWED_SOURCES.has(source)) return apiResponse.badRequest(res, 'Unsupported photo source.');
  if (UNSAFE_KEY.test(key)) return apiResponse.badRequest(res, 'Invalid characters in photo key.');
  if (key.includes('..')) return apiResponse.badRequest(res, 'Invalid photo key.');

  const verdict = verifyLink({ key, source, uid, purpose: 'download' }, exp, sig);
  if (verdict !== 'ok') {
    return apiResponse.unauthorized(
      res,
      verdict === 'expired'
        ? 'This download link has expired. Ask FibreFlow for a fresh manifest.'
        : 'Invalid download link.',
    );
  }

  // Keyed on the user the link was minted for, so one grant cannot be fanned out.
  if (!rateLimiter.check(`photo-download:${uid}`, RATE_LIMIT, RATE_WINDOW_MS).success) {
    return apiResponse.error(res, ErrorCode.RATE_LIMIT, 'Too many photo downloads — slow down and retry.');
  }

  const upstream =
    `${LOOPBACK_BASE}/api/construction-qa/photo-proxy` +
    `?key=${encodeURIComponent(key)}&source=${encodeURIComponent(source)}${vlmProxyKeyParam()}`;

  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const disarm = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  try {
    const upstreamRes = await fetch(upstream, { signal: controller.signal });
    // Headers are in: the fetch is done and the body is now the client's business.
    disarm();
    if (!upstreamRes.ok || !upstreamRes.body) {
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
              : 'photo-proxy returned an unexpected status or an empty body',
        },
        'photos-download',
      );
      return apiResponse.internalError(res, new Error('Could not fetch that photo'));
    }

    res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'image/jpeg');
    const upstreamLength = upstreamRes.headers.get('content-length');
    if (upstreamLength) res.setHeader('Content-Length', upstreamLength);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(key)}"`);
    // A signed link is a credential; a shared cache must never keep what it fetched.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // PIPED, never buffered. The earlier buffering implementation in this same photo
    // subsystem drove the production heap past 12 GB and caused multi-hundred-millisecond
    // GC pauses across every route (see src/lib/construction-qa/minioPhotoStream.ts).
    // This route is built for a sandbox pulling thousands of images concurrently, so
    // collecting each 9 MB photo into memory first would reproduce that exactly.
    await pipeline(Readable.fromWeb(upstreamRes.body as Parameters<typeof Readable.fromWeb>[0]), res);
    return;
  } catch (error) {
    log.error(
      'Photo download failed',
      { module: 'photos-download', error: (error as Error).message, key, userId: uid },
      'photos-download',
    );
    // `destroyed` and `writableEnded`, not just `headersSent`. When the source fails
    // before the first byte, stream/promises pipeline destroys the destination without
    // any header having been sent — so `headersSent` is false, the 500 below does NOT
    // throw, and it is silently swallowed by a dead socket. The caller then sees a bare
    // connection reset while this code believes it answered.
    if (res.headersSent || res.destroyed || res.writableEnded) {
      res.destroy();
      return;
    }
    return apiResponse.internalError(res, new Error('Photo download failed'));
  } finally {
    disarm();
  }
}
