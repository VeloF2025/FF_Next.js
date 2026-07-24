/**
 * H&S Toolbox Talk detail API
 *
 * GET    /api/health-safety/toolbox/[talkId] - Talk + attendance register
 * PATCH  /api/health-safety/toolbox/[talkId] - Update talk fields
 * DELETE /api/health-safety/toolbox/[talkId] - Delete talk (cascades attendance)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { talkId } = req.query;
  if (!talkId || typeof talkId !== 'string') {
    return apiResponse.badRequest(res, 'talkId is required');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(talkId, res);
      case 'PATCH':
        return handlePatch(talkId, req, res);
      case 'DELETE':
        return handleDelete(talkId, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PATCH', 'DELETE']);
    }
  } catch (error) {
    log.error('[H&S Toolbox Detail API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(talkId: string, res: NextApiResponse) {
  const [talk] = await sql`
    SELECT t.*, p.project_name
    FROM hs_toolbox_talks t
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.id = ${talkId}
  `;
  if (!talk) {
    return apiResponse.notFound(res, 'Toolbox talk', talkId);
  }

  const attendance = await sql`
    SELECT * FROM hs_toolbox_attendance
    WHERE talk_id = ${talkId}
    ORDER BY created_at
  `;

  return apiResponse.success(res, { talk, attendance });
}

async function handlePatch(talkId: string, req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const { topic, talk_type, talk_date, presenter_name, presenter_staff_id, location, notes, photo_urls } = req.body;
  const hasPhotos = Object.prototype.hasOwnProperty.call(req.body, 'photo_urls');
  const photos = hasPhotos && Array.isArray(photo_urls) ? photo_urls.filter((u) => typeof u === 'string') : null;

  const rows = await sql`
    UPDATE hs_toolbox_talks
    SET
      topic = COALESCE(${topic ?? null}, topic),
      talk_type = COALESCE(${talk_type ?? null}, talk_type),
      talk_date = COALESCE(${talk_date ?? null}::date, talk_date),
      presenter_name = COALESCE(${presenter_name ?? null}, presenter_name),
      presenter_staff_id = COALESCE(${presenter_staff_id ?? null}::uuid, presenter_staff_id),
      location = COALESCE(${location ?? null}, location),
      notes = COALESCE(${notes ?? null}, notes),
      photo_urls = CASE WHEN ${hasPhotos} THEN ${JSON.stringify(photos ?? [])}::jsonb ELSE photo_urls END,
      updated_at = NOW()
    WHERE id = ${talkId}
    RETURNING *
  `;
  if (rows.length === 0) {
    return apiResponse.notFound(res, 'Toolbox talk', talkId);
  }

  await logHsActivity({
    activityType: 'toolbox_talk_updated',
    entityType: 'toolbox_talk',
    entityId: talkId,
    description: `Toolbox talk updated: ${rows[0]!.topic}`,
    user,
  });

  return apiResponse.success(res, rows[0]);
}

async function handleDelete(talkId: string, req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const rows = await sql`DELETE FROM hs_toolbox_talks WHERE id = ${talkId} RETURNING id, topic`;
  if (rows.length === 0) {
    return apiResponse.notFound(res, 'Toolbox talk', talkId);
  }

  await logHsActivity({
    activityType: 'toolbox_talk_deleted',
    entityType: 'toolbox_talk',
    entityId: talkId,
    description: `Toolbox talk deleted: ${rows[0]!.topic}`,
    user,
  });

  return apiResponse.success(res, { deleted: true, id: talkId });
}

export default withAuth(handler);
