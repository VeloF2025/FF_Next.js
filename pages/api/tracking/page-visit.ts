import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const userId = (req as any).user?.id;
  if (!userId) return apiResponse.unauthorized(res);

  try {
    const { route } = req.body;

    if (!route || typeof route !== 'string') {
      return apiResponse.badRequest(res, 'route is required');
    }

    // Normalize: strip query params, take only the base path
    const basePath = route.split('?')[0];

    await sql`
      INSERT INTO user_page_visits (user_id, route, visit_count, last_visited_at)
      VALUES (${userId}, ${basePath}, 1, NOW())
      ON CONFLICT (user_id, route)
      DO UPDATE SET
        visit_count = user_page_visits.visit_count + 1,
        last_visited_at = NOW()
    `;

    return apiResponse.success(res, { tracked: true });
  } catch (error) {
    log.error('Failed to track page visit', { error, userId });
    return apiResponse.internalError(res, 'Failed to track page visit');
  }
}

export default withAuth(handler);
