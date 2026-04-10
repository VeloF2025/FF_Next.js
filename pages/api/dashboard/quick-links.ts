import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { ROLE_DEFAULT_TOOLS } from '@/modules/dashboard/config/roleDefaultTools';

const sql = neon(process.env.DATABASE_URL!);

const MIN_VISITS_FOR_DYNAMIC = 20;
const MAX_TOOLS = 6;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const userId = (req as any).user?.id;
  const userRole = (req as any).user?.role;
  if (!userId) return apiResponse.unauthorized(res);

  try {
    // Get total visit count to determine if we have enough data
    const totalResult = await sql`
      SELECT COALESCE(SUM(visit_count), 0) as total
      FROM user_page_visits
      WHERE user_id = ${userId}
    `;
    const totalVisits = Number(totalResult[0]?.total || 0);

    // Get top visited routes
    const topRoutes = await sql`
      SELECT route, visit_count, last_visited_at
      FROM user_page_visits
      WHERE user_id = ${userId}
      ORDER BY visit_count DESC
      LIMIT ${MAX_TOOLS}
    `;

    // Get role defaults
    const roleDefaults = ROLE_DEFAULT_TOOLS[userRole] ?? ROLE_DEFAULT_TOOLS['viewer'] ?? [];

    // If not enough history, return role defaults
    if (totalVisits < MIN_VISITS_FOR_DYNAMIC) {
      return apiResponse.success(res, {
        tools: roleDefaults.slice(0, MAX_TOOLS),
        source: 'role_defaults' as const,
        totalVisits,
      });
    }

    // Merge: usage-based tools, fill remaining with role defaults
    const usageTools = topRoutes.map((row: any) => ({
      route: row.route,
      visitCount: row.visit_count,
      lastVisited: row.last_visited_at,
    }));

    return apiResponse.success(res, {
      tools: usageTools,
      source: 'usage' as const,
      totalVisits,
      roleDefaults: roleDefaults.slice(0, MAX_TOOLS),
    });
  } catch (error) {
    log.error('Failed to fetch quick links', { error, userId });
    return apiResponse.internalError(res, 'Failed to fetch quick links');
  }
}

export default withAuth(handler);
