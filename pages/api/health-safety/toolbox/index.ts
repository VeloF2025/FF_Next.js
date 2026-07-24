/**
 * H&S Toolbox Talks API
 *
 * GET  /api/health-safety/toolbox            - List talks (filter: project_id)
 * POST /api/health-safety/toolbox            - Create a talk
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res);
      case 'POST':
        return handlePost(req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
    }
  } catch (error) {
    log.error('[H&S Toolbox API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : null;

  // Each talk with its attendee count and how many have signed.
  const talks = await sql`
    SELECT t.*, p.project_name,
      (SELECT COUNT(*) FROM hs_toolbox_attendance a WHERE a.talk_id = t.id)::int AS attendee_count,
      (SELECT COUNT(*) FROM hs_toolbox_attendance a WHERE a.talk_id = t.id AND a.signature_name IS NOT NULL)::int AS signed_count
    FROM hs_toolbox_talks t
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE (${projectId}::uuid IS NULL OR t.project_id = ${projectId}::uuid)
    ORDER BY t.talk_date DESC, t.created_at DESC
  `;

  return apiResponse.success(res, { talks });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const userId = user?.id ?? null;
  const { project_id, topic, talk_type, talk_date, presenter_name, presenter_staff_id, location, notes, photo_urls } =
    req.body;

  if (!topic || !talk_date) {
    return apiResponse.badRequest(res, 'topic and talk_date are required');
  }

  const photos = Array.isArray(photo_urls) ? photo_urls.filter((u) => typeof u === 'string') : [];

  const rows = await sql`
    INSERT INTO hs_toolbox_talks (
      project_id, topic, talk_type, talk_date, presenter_name,
      presenter_staff_id, location, notes, photo_urls, created_by
    ) VALUES (
      ${project_id || null},
      ${topic},
      ${talk_type || 'toolbox'},
      ${talk_date},
      ${presenter_name || null},
      ${presenter_staff_id || null},
      ${location || null},
      ${notes || null},
      ${JSON.stringify(photos)}::jsonb,
      ${userId}
    )
    RETURNING *
  `;
  const talk = rows[0]!;

  await logHsActivity({
    activityType: 'toolbox_talk_created',
    entityType: 'toolbox_talk',
    entityId: talk.id as string,
    description: `Toolbox talk logged: ${topic}`,
    metadata: { project_id: project_id || null, talk_type: talk_type || 'toolbox' },
    user,
  });

  return apiResponse.created(res, talk);
}

export default withAuth(handler);
