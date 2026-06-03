/**
 * GET /api/activate/civil-photo-gallery/photo?id=<uuid>
 *
 * Proxy endpoint for civil gallery photos stored as Microsoft Graph API URLs.
 * Fetches the image server-side using the app's Graph credentials and streams
 * it to the browser — the browser cannot load Graph URLs directly (requires OAuth).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { pool } from '@/lib/db';
import { log } from '@/lib/logger';
import { getGraphAccessToken } from '@/lib/graph/auth';
import { isGraphPhotoUrl } from '@/lib/graph/isGraphPhotoUrl';

const MODULE = 'CivilGalleryPhoto';

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).end();
    return;
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    res.status(400).json({ error: 'id required' });
    return;
  }

  try {
    // Look up the photo URL from the gallery table
    const { rows } = await pool.query<{ photo_url: string }>(
      `SELECT photo_url FROM vlm_visual_photo_examples WHERE id = $1 AND job_type = 'civils' LIMIT 1`,
      [id]
    );
    if (!rows[0]) {
      res.status(404).end();
      return;
    }

    const photoUrl = rows[0].photo_url;

    // Only ever attach the Graph Bearer token to a canonical Graph URL — never
    // forward the credential to any other origin (SSRF / token-leak guard).
    if (!isGraphPhotoUrl(photoUrl)) {
      log.error('Refusing to proxy non-Graph photo url', { id }, MODULE);
      res.status(502).end();
      return;
    }

    const token = await getGraphAccessToken();
    const upstream = await fetch(photoUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!upstream.ok) {
      log.warn('Graph photo fetch failed', { id, status: upstream.status }, MODULE);
      res.status(upstream.status).end();
      return;
    }

    // Only forward image content types — never let upstream HTML/scripts render
    // within the app origin.
    const upstreamType = upstream.headers.get('content-type') ?? '';
    const contentType = upstreamType.startsWith('image/') ? upstreamType : 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Auth-protected: allow private (per-user) caching only, never shared caches.
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const buffer = await upstream.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    log.error('Civil gallery photo proxy error', { id, err: String(err) }, MODULE);
    res.status(500).end();
  }
}

export default withAuth(handler);
