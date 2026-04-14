import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['DELETE']);
  }

  const userId = (req as any).user?.id;
  if (!userId) return apiResponse.error(res, ErrorCode.UNAUTHORIZED, 'Unauthorized');

  const { id } = req.query;
  if (!id) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Reminder ID is required');
  }

  try {
    const result = await sql`
      DELETE FROM reminders
      WHERE id = ${id as string} AND user_id = ${userId}
      RETURNING id
    `;

    if (result.length === 0) {
      return apiResponse.error(res, ErrorCode.NOT_FOUND, 'Reminder not found');
    }

    return apiResponse.success(res, { id }, 'Reminder deleted successfully');
  } catch (error) {
    log.error(`Error deleting reminder: ${error}`, undefined, 'RemindersDelete');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
