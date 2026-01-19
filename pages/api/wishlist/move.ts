import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuth } from '../../../lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { MoveWishlistItemInput } from '@/modules/wishlist/types/wishlist';

const sql = neon(process.env.NEON_DATABASE_URL || process.env.DATABASE_URL!);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Enable CORS
  apiResponse.setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return apiResponse.handleOptions(res);
  }

  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res);
  }

  // Check authentication
  const { userId } = getAuth(req);
  if (!userId) {
    return apiResponse.unauthorized(res);
  }

  const { itemId, targetColumn, position } = req.body as MoveWishlistItemInput;

  if (!itemId || !targetColumn) {
    return apiResponse.badRequest(res, 'Item ID and target column are required');
  }

  try {
    // Verify the target column exists
    const columns = await sql`
      SELECT name FROM wishlist_columns WHERE name = ${targetColumn}
    `;

    if (columns.length === 0) {
      return apiResponse.badRequest(res, 'Invalid target column');
    }

    // Check WIP limit for target column (except Backlog and Completed)
    if (targetColumn !== 'Backlog' && targetColumn !== 'Completed') {
      const columnInfo = await sql`
        SELECT wip_limit FROM wishlist_columns WHERE name = ${targetColumn}
      `;

      if (columnInfo[0].wip_limit) {
        const currentItems = await sql`
          SELECT COUNT(*) as count FROM wishlist_items WHERE status = ${targetColumn}
        `;

        if (currentItems[0].count >= columnInfo[0].wip_limit) {
          return apiResponse.badRequest(res, `WIP limit reached for ${targetColumn}. Maximum ${columnInfo[0].wip_limit} items allowed.`);
        }
      }
    }

    // Update the item's status and position
    const updated = await sql`
      UPDATE wishlist_items
      SET
        status = ${targetColumn},
        column_position = ${position || 0},
        updated_at = NOW()
      WHERE id = ${itemId}
      RETURNING *
    `;

    if (updated.length === 0) {
      return apiResponse.notFound(res, 'Wishlist item', itemId);
    }

    log.info('Moved wishlist item', {
      itemId,
      targetColumn,
      position,
      userId
    });

    return apiResponse.success(res, {
      success: true,
      item: updated[0]
    });
  } catch (error) {
    log.error('Wishlist move API error', error);
    return apiResponse.internalError(res, error);
  }
}