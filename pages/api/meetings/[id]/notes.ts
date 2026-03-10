/**
 * PATCH /api/meetings/[id]/notes
 * Update meeting user notes
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['PATCH']);
  }

  const authReq = req as AuthenticatedNextApiRequest;
  const userEmail = authReq.user?.email?.toLowerCase();
  const userName = authReq.user?.name?.toLowerCase() || '';
  const isHein = userEmail === 'hein@velocityfibre.co.za';
  const meetingId = req.query.id as string;
  const { notes } = req.body;

  if (!userEmail) {
    return apiResponse.forbidden(res, 'User email required for meeting access');
  }

  if (typeof notes !== 'string') {
    return apiResponse.badRequest(res, 'notes must be a string');
  }

  try {
    // Hein can update any meeting's notes; others must be a participant
    const result = isHein
      ? await sql`
          UPDATE meetings
          SET user_notes = ${notes}
          WHERE id = ${meetingId}
          RETURNING id, user_notes
        `
      : await sql`
          UPDATE meetings
          SET user_notes = ${notes}
          WHERE id = ${meetingId}
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(participants) AS p
              WHERE LOWER(p->>'email') = ${userEmail}
                 OR LOWER(p->>'name') = ${userName}
                 OR LOWER(p->>'displayName') = ${userName}
            )
          RETURNING id, user_notes
        `;

    if (result.length === 0) {
      return apiResponse.forbidden(res, 'Meeting not found or you are not a participant');
    }

    return apiResponse.success(res, result[0]);
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
