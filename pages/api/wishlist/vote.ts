import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuth } from '../../../lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

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

  const { itemId } = req.body;

  if (!itemId) {
    return apiResponse.badRequest(res, 'Item ID is required');
  }

  try {
    // Check if user has already voted
    const existingVote = await sql`
      SELECT * FROM wishlist_votes
      WHERE item_id = ${itemId} AND user_id = ${userId}
    `;

    if (existingVote.length > 0) {
      // User has already voted - toggle vote (remove it)
      await sql`
        DELETE FROM wishlist_votes
        WHERE item_id = ${itemId} AND user_id = ${userId}
      `;

      // Decrement vote count
      await sql`
        UPDATE wishlist_items
        SET votes = GREATEST(votes - 1, 0)
        WHERE id = ${itemId}
      `;

      log.info('Removed vote from wishlist item', { itemId, userId });

      return apiResponse.success(res, {
        success: true,
        voted: false,
        message: 'Vote removed'
      });
    } else {
      // Add new vote
      const userName = 'User'; // Replace with actual user name lookup

      await sql`
        INSERT INTO wishlist_votes (item_id, user_id, user_name)
        VALUES (${itemId}, ${userId}, ${userName})
      `;

      // Increment vote count
      const updated = await sql`
        UPDATE wishlist_items
        SET votes = votes + 1
        WHERE id = ${itemId}
        RETURNING votes
      `;

      log.info('Added vote to wishlist item', { itemId, userId });

      return apiResponse.success(res, {
        success: true,
        voted: true,
        message: 'Vote recorded',
        votes: updated[0].votes
      });
    }
  } catch (error) {
    log.error('Wishlist vote API error', error);
    return apiResponse.internalError(res, error);
  }
}