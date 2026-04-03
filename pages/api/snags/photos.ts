/**
 * Snag Photos API
 * GET  /api/snags/photos?snagId=X — List photos for a snag
 * POST /api/snags/photos — Add a photo record to a snag
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { SnagPhoto, CreateSnagPhotoRequest } from '@/modules/construction-qa/types/snag.types';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res);
      case 'POST':
        return await handlePost(req, res);
      case 'DELETE':
        return await handleDelete(req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET', 'POST', 'DELETE']);
    }
  } catch (error) {
    log.error('Snag photos API error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { snagId, phase } = req.query;

  if (!snagId || typeof snagId !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'snagId query parameter is required');
  }

  if (phase && typeof phase === 'string') {
    const rows = await sql`
      SELECT * FROM snag_photos
      WHERE snag_id = ${snagId} AND phase = ${phase}
      ORDER BY created_at ASC
    ` as SnagPhoto[];

    return apiResponse.success(res, rows);
  }

  const rows = await sql`
    SELECT * FROM snag_photos
    WHERE snag_id = ${snagId}
    ORDER BY
      CASE phase
        WHEN 'before'  THEN 1
        WHEN 'during'  THEN 2
        WHEN 'after'   THEN 3
        ELSE 4
      END,
      created_at ASC
  ` as SnagPhoto[];

  return apiResponse.success(res, rows);
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = req.body as CreateSnagPhotoRequest;

  if (!body.snag_id) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'snag_id is required');
  }
  if (!body.phase || !['before', 'during', 'after'].includes(body.phase)) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'phase must be before, during, or after');
  }
  if (!body.photo_url || !body.photo_url.trim()) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'photo_url is required');
  }
  if (!body.source) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'source is required');
  }

  // Verify the snag exists
  const snagCheck = await sql`
    SELECT id FROM snags WHERE id = ${body.snag_id}
  `;
  if (snagCheck.length === 0) {
    return apiResponse.notFound(res, 'Snag', body.snag_id);
  }

  const rows = await sql`
    INSERT INTO snag_photos (
      snag_id, phase, photo_url, thumbnail_url,
      pole_reference, caption, source
    ) VALUES (
      ${body.snag_id},
      ${body.phase},
      ${body.photo_url.trim()},
      ${body.thumbnail_url ?? null},
      ${body.pole_reference ?? null},
      ${body.caption ?? null},
      ${body.source}
    )
    ON CONFLICT (snag_id, phase, photo_url) DO UPDATE
      SET thumbnail_url  = EXCLUDED.thumbnail_url,
          pole_reference = EXCLUDED.pole_reference,
          caption        = EXCLUDED.caption
    RETURNING *
  ` as SnagPhoto[];

  if (!rows[0]) {
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to add photo');
  }

  log.info('Snag photo added', {
    snagId: body.snag_id,
    phase: body.phase,
    source: body.source,
  });

  return apiResponse.created(res, rows[0]);
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'id query parameter is required');
  }

  const existing = await sql`
    SELECT id FROM snag_photos WHERE id = ${id}
  ` as Array<{ id: string }>;

  if (existing.length === 0) {
    return apiResponse.notFound(res, 'Snag photo', id);
  }

  await sql`
    DELETE FROM snag_photos WHERE id = ${id}
  `;

  log.info('Snag photo deleted', { photoId: id });
  return apiResponse.success(res, { id }, 'Photo deleted');
}

export default withAuth(handler);
