import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuth } from '../../../lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { WishlistBoard, CreateWishlistItemInput } from '@/modules/wishlist/types/wishlist';

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

  // Check authentication
  const { userId } = getAuth(req);
  if (!userId) {
    return apiResponse.unauthorized(res);
  }

  try {
    switch (req.method) {
      case 'GET': {
        // Fetch all columns
        const columns = await sql`
          SELECT * FROM wishlist_columns
          ORDER BY position
        `;

        // Fetch all items with vote status for current user
        const items = await sql`
          SELECT
            wi.*,
            CASE WHEN wv.user_id IS NOT NULL THEN true ELSE false END as has_voted,
            (SELECT COUNT(*) FROM wishlist_comments WHERE item_id = wi.id) as comments_count
          FROM wishlist_items wi
          LEFT JOIN wishlist_votes wv ON wi.id = wv.item_id AND wv.user_id = ${userId}
          ORDER BY wi.column_position, wi.created_at DESC
        `;

        // Group items by column
        const columnsWithItems = columns.map(column => ({
          ...column,
          items: items.filter((item: any) => item.status === column.name)
        }));

        // Calculate statistics
        const stats = {
          total: items.length,
          totalVotes: items.reduce((sum: number, item: any) => sum + (item.votes || 0), 0),
          inProgress: items.filter((item: any) => item.status === 'In Progress').length,
          completed: items.filter((item: any) => item.status === 'Completed').length,
          byPriority: {
            low: items.filter((item: any) => item.priority === 'low').length,
            medium: items.filter((item: any) => item.priority === 'medium').length,
            high: items.filter((item: any) => item.priority === 'high').length,
          },
          byStatus: columns.reduce((acc: any, col: any) => {
            acc[col.name] = items.filter((item: any) => item.status === col.name).length;
            return acc;
          }, {})
        };

        const board: WishlistBoard = {
          columns: columnsWithItems,
          stats
        };

        return apiResponse.success(res, board);
      }

      case 'POST': {
        const input = req.body as CreateWishlistItemInput;

        // Validate required fields
        if (!input.title) {
          return apiResponse.badRequest(res, 'Title is required');
        }

        // Get user details from Clerk (you may need to fetch this from your users table)
        // For now, we'll use the userId
        const userName = 'User'; // Replace with actual user name lookup

        // Create new wishlist item
        const newItem = await sql`
          INSERT INTO wishlist_items (
            title,
            description,
            priority,
            effort_estimate,
            business_value,
            created_by,
            created_by_name
          ) VALUES (
            ${input.title},
            ${input.description || null},
            ${input.priority || 'medium'},
            ${input.effort_estimate || null},
            ${input.business_value || null},
            ${userId},
            ${userName}
          )
          RETURNING *
        `;

        log.info('Created wishlist item', { itemId: newItem[0].id, userId });

        return apiResponse.created(res, newItem[0]);
      }

      default: {
        return apiResponse.methodNotAllowed(res);
      }
    }
  } catch (error) {
    log.error('Wishlist API error', error);
    return apiResponse.internalError(res, error);
  }
}