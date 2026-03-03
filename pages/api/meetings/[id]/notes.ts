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
  const meetingId = req.query.id as string;
  const { notes } = req.body;

  if (typeof notes !== 'string') {
    return apiResponse.badRequest(res, 'notes must be a string');
  }

  try {
    const result = await sql`
      UPDATE meetings
      SET user_notes = ${notes}
      WHERE id = ${meetingId}
      RETURNING id, user_notes
    `;

    if (result.length === 0) {
      return apiResponse.notFound(res, 'Meeting', meetingId);
    }

    return apiResponse.success(res, result[0]);
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
