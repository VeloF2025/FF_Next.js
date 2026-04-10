import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);

const MAX_PINS = 6;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = (req as any).user?.id;
  if (!userId) return apiResponse.unauthorized(res);

  try {
    if (req.method === 'GET') {
      const pins = await sql`
        SELECT id, label, route, icon, color, sort_order, expires_at, created_at
        FROM user_pinned_links
        WHERE user_id = ${userId}
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY sort_order, created_at
      `;

      return apiResponse.success(res, { pins });
    }

    if (req.method === 'POST') {
      const { label, route, icon, color, expiresAt } = req.body;

      if (!label || !route) {
        return apiResponse.badRequest(res, 'label and route are required');
      }

      // Check pin limit
      const countResult = await sql`
        SELECT COUNT(*) as count
        FROM user_pinned_links
        WHERE user_id = ${userId}
          AND (expires_at IS NULL OR expires_at > NOW())
      `;
      const currentCount = Number(countResult[0]?.count || 0);

      if (currentCount >= MAX_PINS) {
        return apiResponse.badRequest(res, `Maximum ${MAX_PINS} pins allowed. Remove one first.`);
      }

      // Check for duplicate route
      const existing = await sql`
        SELECT id FROM user_pinned_links
        WHERE user_id = ${userId} AND route = ${route}
          AND (expires_at IS NULL OR expires_at > NOW())
      `;

      if (existing.length > 0) {
        return apiResponse.badRequest(res, 'This view is already pinned');
      }

      const result = await sql`
        INSERT INTO user_pinned_links (user_id, label, route, icon, color, sort_order, expires_at)
        VALUES (
          ${userId},
          ${label},
          ${route},
          ${icon || null},
          ${color || null},
          ${currentCount},
          ${expiresAt || null}
        )
        RETURNING id, label, route, icon, color, sort_order, expires_at, created_at
      `;

      return apiResponse.created(res, { pin: result[0] });
    }

    if (req.method === 'DELETE') {
      const { id, route } = req.query;

      if (id) {
        await sql`
          DELETE FROM user_pinned_links
          WHERE id = ${id as string} AND user_id = ${userId}
        `;
      } else if (route) {
        await sql`
          DELETE FROM user_pinned_links
          WHERE route = ${route as string} AND user_id = ${userId}
        `;
      } else {
        return apiResponse.badRequest(res, 'id or route query param required');
      }

      return apiResponse.success(res, { unpinned: true });
    }

    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST', 'DELETE']);
  } catch (error) {
    log.error('Failed to manage pinned links', { error, userId });
    return apiResponse.internalError(res, 'Failed to manage pinned links');
  }
}

export default withAuth(handler);
