/**
 * H&S Toolbox Talk attendance API
 *
 * POST   /api/health-safety/toolbox/[talkId]/attendance   - Add an attendee (with typed e-signature)
 * DELETE /api/health-safety/toolbox/[talkId]/attendance?attendanceId=… - Remove an attendee
 *
 * A worker is recorded by name (required); staff_id/team_member_id links are
 * optional and mutually exclusive. If the attendee types their name it is
 * captured as an e-signature (§4.5): typed name + timestamp + capturing user
 * uuid + server-derived IP.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import { captureESignature } from '@/modules/health-safety/services/esignature';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { talkId } = req.query;
  if (!talkId || typeof talkId !== 'string') {
    return apiResponse.badRequest(res, 'talkId is required');
  }

  try {
    switch (req.method) {
      case 'POST':
        return handlePost(talkId, req, res);
      case 'DELETE':
        return handleDelete(talkId, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST', 'DELETE']);
    }
  } catch (error) {
    log.error('[H&S Toolbox Attendance API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handlePost(talkId: string, req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const { staff_id, team_member_id, signature_name } = req.body;
  const worker_name = typeof req.body.worker_name === 'string' ? req.body.worker_name.trim() : '';

  if (!worker_name) {
    return apiResponse.badRequest(res, 'worker_name is required');
  }
  if (staff_id && team_member_id) {
    return apiResponse.badRequest(res, 'An attendee is staff OR a team member, not both');
  }

  // Confirm the talk exists (FK would fail anyway, but a 404 is clearer).
  const [talk] = await sql`SELECT id FROM hs_toolbox_talks WHERE id = ${talkId}`;
  if (!talk) {
    return apiResponse.notFound(res, 'Toolbox talk', talkId);
  }

  // Capture the typed signature server-side (IP is never client-supplied).
  const sig =
    signature_name && typeof signature_name === 'string' && signature_name.trim().length > 0
      ? captureESignature(req, signature_name, user, new Date())
      : null;

  const rows = await sql`
    INSERT INTO hs_toolbox_attendance (
      talk_id, staff_id, team_member_id, worker_name,
      signature_name, signed_at, signed_by, signed_ip
    ) VALUES (
      ${talkId},
      ${staff_id || null},
      ${team_member_id || null},
      ${worker_name},
      ${sig?.signature_name ?? null},
      ${sig?.signed_at ?? null}::timestamptz,
      ${sig?.signed_by ?? null},
      ${sig?.signed_ip ?? null}
    )
    RETURNING *
  `;

  await logHsActivity({
    activityType: 'toolbox_attendee_added',
    entityType: 'toolbox_talk',
    entityId: talkId,
    description: `Attendee recorded on toolbox talk: ${worker_name}${sig ? ' (signed)' : ''}`,
    metadata: { signed: sig != null },
    user,
  });

  return apiResponse.created(res, rows[0]);
}

async function handleDelete(talkId: string, req: NextApiRequest, res: NextApiResponse) {
  const attendanceId = typeof req.query.attendanceId === 'string' ? req.query.attendanceId : null;
  if (!attendanceId) {
    return apiResponse.badRequest(res, 'attendanceId query param is required');
  }

  const rows = await sql`
    DELETE FROM hs_toolbox_attendance
    WHERE id = ${attendanceId} AND talk_id = ${talkId}
    RETURNING id, worker_name, (signature_name IS NOT NULL) AS was_signed
  `;
  if (rows.length === 0) {
    return apiResponse.notFound(res, 'Attendance record', attendanceId);
  }

  // Removing a register entry — possibly a captured e-signature — must leave an
  // audit trail, like every other mutation in this module.
  await logHsActivity({
    activityType: 'toolbox_attendee_removed',
    entityType: 'toolbox_talk',
    entityId: talkId,
    description: `Attendee removed from toolbox talk: ${rows[0]!.worker_name}`,
    metadata: { was_signed: rows[0]!.was_signed === true },
    user: getAuthUser(req),
  });

  return apiResponse.success(res, { deleted: true, id: attendanceId });
}

export default withAuth(handler);
