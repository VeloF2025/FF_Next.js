import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuth } from '../../../lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { UpdateWishlistItemInput } from '@/modules/wishlist/types/wishlist';

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

  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Invalid item ID');
  }

  try {
    switch (req.method) {
      case 'GET': {
        // Get single wishlist item with details
        const item = await sql`
          SELECT
            wi.*,
            CASE WHEN wv.user_id IS NOT NULL THEN true ELSE false END as has_voted,
            (SELECT COUNT(*) FROM wishlist_comments WHERE item_id = wi.id) as comments_count
          FROM wishlist_items wi
          LEFT JOIN wishlist_votes wv ON wi.id = wv.item_id AND wv.user_id = ${userId}
          WHERE wi.id = ${id}
        `;

        if (item.length === 0) {
          return apiResponse.notFound(res, 'Wishlist item', id);
        }

        // Get comments
        const comments = await sql`
          SELECT * FROM wishlist_comments
          WHERE item_id = ${id}
          ORDER BY created_at DESC
        `;

        return apiResponse.success(res, {
          item: item[0],
          comments
        });
      }

      case 'PUT': {
        const updates = req.body as UpdateWishlistItemInput;

        // Build update query dynamically
        const updateFields = [];
        const updateValues = [];
        let paramCount = 1;

        if (updates.title !== undefined) {
          updateFields.push(`title = $${paramCount++}`);
          updateValues.push(updates.title);
        }
        if (updates.description !== undefined) {
          updateFields.push(`description = $${paramCount++}`);
          updateValues.push(updates.description);
        }
        if (updates.status !== undefined) {
          updateFields.push(`status = $${paramCount++}`);
          updateValues.push(updates.status);
        }
        if (updates.priority !== undefined) {
          updateFields.push(`priority = $${paramCount++}`);
          updateValues.push(updates.priority);
        }
        if (updates.effort_estimate !== undefined) {
          updateFields.push(`effort_estimate = $${paramCount++}`);
          updateValues.push(updates.effort_estimate);
        }
        if (updates.business_value !== undefined) {
          updateFields.push(`business_value = $${paramCount++}`);
          updateValues.push(updates.business_value);
        }
        if (updates.assigned_to !== undefined) {
          updateFields.push(`assigned_to = $${paramCount++}`);
          updateValues.push(updates.assigned_to);
        }
        if (updates.assigned_to_name !== undefined) {
          updateFields.push(`assigned_to_name = $${paramCount++}`);
          updateValues.push(updates.assigned_to_name);
        }

        if (updateFields.length === 0) {
          return apiResponse.badRequest(res, 'No fields to update');
        }

        // Always update the updated_at field
        updateFields.push(`updated_at = NOW()`);

        // Add the ID as the last parameter
        updateValues.push(id);

        const updateQuery = `
          UPDATE wishlist_items
          SET ${updateFields.join(', ')}
          WHERE id = $${paramCount}
          RETURNING *
        `;

        const updated = await sql(updateQuery, updateValues);

        if (updated.length === 0) {
          return apiResponse.notFound(res, 'Wishlist item', id);
        }

        log.info('Updated wishlist item', { itemId: id, userId });

        return apiResponse.success(res, updated[0]);
      }

      case 'DELETE': {
        // Check if user is authorized to delete (e.g., creator or admin)
        const item = await sql`
          SELECT created_by FROM wishlist_items WHERE id = ${id}
        `;

        if (item.length === 0) {
          return apiResponse.notFound(res, 'Wishlist item', id);
        }

        // For now, allow creator or any user to delete
        // You can add role-based checks here
        // if (item[0].created_by !== userId && !isAdmin) {
        //   return apiResponse.forbidden(res, 'Only the creator can delete this item');
        // }

        await sql`
          DELETE FROM wishlist_items WHERE id = ${id}
        `;

        log.info('Deleted wishlist item', { itemId: id, userId });

        return apiResponse.success(res, { message: 'Item deleted successfully' });
      }

      default: {
        return apiResponse.methodNotAllowed(res);
      }
    }
  } catch (error) {
    log.error('Wishlist item API error', error);
    return apiResponse.internalError(res, error);
  }
}