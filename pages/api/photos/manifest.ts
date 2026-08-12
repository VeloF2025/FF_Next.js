/**
 * GET /api/photos/manifest — the download plan for a photo filter.
 *
 * Two modes on one route, because they are two halves of one handshake:
 *
 *   1. Authenticated (session or bearer): RBAC is checked, the filter is counted, and a
 *      SHORT summary plus a signed URL back to mode 2 is returned. This stays tiny no
 *      matter how many photos match — an MCP tool result cannot carry 10,000 rows.
 *   2. Signed (?f=&uid=&exp=&sig=): returns the full list with a signed download link
 *      per photo. Claude's Cowork sandbox fetches this itself; it holds no FibreFlow
 *      session, so the signature is the only credential it can carry.
 *
 * There is deliberately NO cap on manifest size (decision: Hein, 2026-08-12 — existing
 * RBAC, no ceiling). Every mint is logged with the user and the match count so a
 * large egress is at least attributable afterwards.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { isConfigured, LINK_TTL_SECONDS, signLink, verifyLink } from '@/lib/photos/photoLinks';
import { allKeysQuery, parseFilter, proxySourceForKey, summaryQuery } from '@/lib/photos/photoQuery';

interface KeyRow {
  storage_key: string;
  filename: string | null;
  step_label: string | null;
  file_size_bytes: string | null;
  captured_at: string | null;
}

function baseUrl(req: NextApiRequest): string {
  // Host header only — never x-forwarded-host, which passes through from any caller
  // here (the nginx configs do not set it). Same reasoning as mcp/resource-metadata.ts.
  const host = req.headers.host ?? '';
  const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  return `${proto}://${host}`;
}

/** A download name that stays unique across poles: keys collide on basename alone. */
function downloadName(key: string, filename: string | null): string {
  const fallback = key.split('/').filter(Boolean).slice(-2).join('_');
  return (filename || fallback || 'photo.jpg').replace(/[^A-Za-z0-9._-]/g, '_');
}

async function serveSignedManifest(req: NextApiRequest, res: NextApiResponse) {
  const f = typeof req.query.f === 'string' ? req.query.f : '';
  const uid = typeof req.query.uid === 'string' ? req.query.uid : '';
  const { exp, sig } = req.query;
  if (!f || !uid) return apiResponse.badRequest(res, 'Incomplete manifest link.');

  const verdict = verifyLink({ f, uid }, exp, sig);
  if (verdict !== 'ok') {
    return apiResponse.unauthorized(
      res,
      verdict === 'expired'
        ? 'This manifest link has expired. Ask FibreFlow for a new one.'
        : 'Invalid manifest link.',
    );
  }

  let filterQuery: Record<string, string>;
  try {
    filterQuery = JSON.parse(Buffer.from(f, 'base64url').toString('utf8'));
  } catch (error) {
    // Only reachable with a VALID signature over a filter this server itself encoded,
    // so this is a bug on our side (an encoding change, say), not user input. Logged
    // rather than swallowed, because silently 400ing would hide it.
    log.error(
      'Signed manifest filter failed to decode',
      { module: 'photos-manifest', userId: uid, error: (error as Error).message },
      'photos-manifest',
    );
    return apiResponse.badRequest(res, 'Malformed manifest filter.');
  }

  const parsed = parseFilter(filterQuery);
  if ('error' in parsed) return apiResponse.badRequest(res, parsed.error);

  const keys = allKeysQuery(parsed.filter);
  const rows = await pool.query<KeyRow>(keys.sql, keys.params as unknown[]);
  const origin = baseUrl(req);

  const photos: Array<Record<string, unknown>> = [];
  for (const row of rows.rows) {
    const source = proxySourceForKey(row.storage_key);
    const signed = signLink({ key: row.storage_key, source, uid });
    if (!signed) {
      // Only reachable if the secret vanished between the isConfigured() check and here.
      // Emitting `&sig=undefined` links instead would hand back a manifest of dead URLs.
      return apiResponse.internalError(res, new Error('Photo link signing is unavailable.'));
    }
    const query =
      `key=${encodeURIComponent(row.storage_key)}&source=${source}&uid=${encodeURIComponent(uid)}` +
      `&exp=${signed.exp}&sig=${signed.sig}`;
    photos.push({
      filename: downloadName(row.storage_key, row.filename),
      type: row.step_label,
      capturedAt: row.captured_at,
      sizeBytes: row.file_size_bytes === null ? null : Number(row.file_size_bytes),
      url: `${origin}/api/photos/download?${query}`,
    });
  }

  log.info(
    'Photo manifest served',
    { module: 'photos-manifest', userId: uid, photos: photos.length },
    'photos-manifest',
  );
  res.setHeader('Cache-Control', 'no-store');
  return apiResponse.success(res, { photos: photos.length, expiresInSeconds: LINK_TTL_SECONDS, files: photos });
}

async function mintManifest(req: NextApiRequest, res: NextApiResponse) {
  const user = (req as AuthenticatedNextApiRequest).user;
  const parsed = parseFilter(req.query);
  if ('error' in parsed) return apiResponse.badRequest(res, parsed.error);

  const summarySql = summaryQuery(parsed.filter);
  const summary = await pool.query<{ matched: number; sized: number; total_bytes: string }>(
    summarySql.sql,
    summarySql.params as unknown[],
  );
  // An aggregate without GROUP BY always returns exactly one row, but the type system
  // cannot know that — and a silent `undefined` here would mint a manifest for a count
  // nobody computed.
  const row = summary.rows[0];
  if (!row) return apiResponse.internalError(res, new Error('Photo summary returned no rows'));
  const { matched, sized } = row;
  const knownBytes = Number(row.total_bytes);

  if (matched === 0) {
    return apiResponse.success(res, { matched: 0, manifestUrl: null, note: 'Nothing matched that filter.' });
  }

  // Re-encode the filter from the PARSED values, not the raw query: the signature must
  // cover exactly what mode 2 will re-run, or the two could diverge on a stray param.
  const filterQuery: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.filter)) {
    if (v !== undefined && k !== 'limit' && k !== 'offset') filterQuery[k] = String(v);
  }
  const f = Buffer.from(JSON.stringify(filterQuery), 'utf8').toString('base64url');
  const signed = signLink({ f, uid: user.id });
  if (!signed) {
    return apiResponse.internalError(
      res,
      new Error('PHOTO_LINK_SECRET is not configured, so download links cannot be signed.'),
    );
  }

  const unsized = matched - sized;
  const estimatedMb =
    sized > 0 ? Math.round(((knownBytes / sized) * matched) / 1048576) : null;

  log.info(
    'Photo manifest minted',
    { module: 'photos-manifest', userId: user.id, matched, filter: filterQuery },
    'photos-manifest',
  );

  const query =
    `f=${f}&uid=${encodeURIComponent(user.id)}&exp=${signed.exp}&sig=${signed.sig}`;
  res.setHeader('Cache-Control', 'no-store');
  return apiResponse.success(res, {
    matched,
    estimatedTotalMb: estimatedMb,
    sizeUnknownFor: unsized,
    sizeNote:
      unsized === 0
        ? 'Exact total.'
        : `Estimate only — ${unsized} of ${matched} photos have no recorded size.`,
    expiresInSeconds: LINK_TTL_SECONDS,
    manifestUrl: `${baseUrl(req)}/api/photos/manifest?${query}`,
  });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }
  if (!isConfigured()) {
    return apiResponse.internalError(
      res,
      new Error('Photo download links are not configured on this server.'),
    );
  }
  try {
    return await serveSignedManifest(req, res);
  } catch (error) {
    log.error(
      'Photo manifest failed',
      { module: 'photos-manifest', error: (error as Error).message },
      'photos-manifest',
    );
    return apiResponse.internalError(res, new Error('Photo manifest failed'));
  }
}

async function authedHandler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }
  if (!isConfigured()) {
    return apiResponse.internalError(
      res,
      new Error('Photo download links are not configured on this server.'),
    );
  }
  try {
    return await mintManifest(req, res);
  } catch (error) {
    log.error(
      'Photo manifest mint failed',
      { module: 'photos-manifest', error: (error as Error).message },
      'photos-manifest',
    );
    return apiResponse.internalError(res, new Error('Photo manifest failed'));
  }
}

const authed = withAuth(withPermission('construction-qa.qa-centre')(authedHandler));

export default function route(req: NextApiRequest, res: NextApiResponse) {
  // A presented signature means mode 2. It is verified before anything is read, so an
  // unauthenticated caller cannot use this branch to skip the session gate — a bad
  // signature is rejected outright rather than falling through to mode 1.
  return req.query.sig ? handler(req, res) : authed(req, res);
}
