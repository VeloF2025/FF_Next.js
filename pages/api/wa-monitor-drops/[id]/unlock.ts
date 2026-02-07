/**
 * WA Monitor Drop Unlock API
 * Unlock a drop after editing to allow others to edit
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({
      success: false,
      error: { message: 'Invalid drop ID' }
    });
  }

  if (req.method === 'POST') {
    try {
      const { userName } = req.body;

      if (!userName || typeof userName !== 'string') {
        return res.status(400).json({
          success: false,
          error: { message: 'User name is required' }
        });
      }

      // Check if drop is locked by this user
      const [existingLock] = await sql`
        SELECT locked_by
        FROM qa_photo_reviews
        WHERE id = ${id}
      `;

      if (!existingLock || !existingLock.locked_by) {
        // Drop is not locked
        return res.status(200).json({
          success: true,
          data: { unlocked: true }
        });
      }

      if (existingLock.locked_by !== userName) {
        // Locked by someone else - don't allow unlock
        return res.status(403).json({
          success: false,
          error: {
            code: 'LOCKED_BY_ANOTHER_USER',
            message: `Drop is locked by ${existingLock.locked_by}. Only they can unlock it.`,
            lockedBy: existingLock.locked_by,
          }
        });
      }

      // Unlock the drop
      await sql`
        UPDATE qa_photo_reviews
        SET
          locked_by = NULL,
          locked_at = NULL
        WHERE id = ${id}
      `;

      return res.status(200).json({
        success: true,
        data: { unlocked: true }
      });

    } catch (error) {
      log.error('Error unlocking drop', { error });
      return res.status(500).json({
        success: false,
        error: { message: 'Failed to unlock drop' }
      });
    }
  }

  return res.status(405).json({
    success: false,
    error: { message: 'Method not allowed' }
  });
}

export default withAuth(handler);
