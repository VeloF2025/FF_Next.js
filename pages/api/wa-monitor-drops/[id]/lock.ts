/**
 * WA Monitor Drop Lock API
 * Lock a drop for editing to prevent concurrent modifications
 */

import type { NextApiRequest, NextApiResponse} from 'next';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || '');

// Lock expires after 5 minutes of inactivity
const LOCK_TIMEOUT_MINUTES = 5;

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

      // Check if drop is already locked (and lock hasn't expired)
      const [existingLock] = await sql`
        SELECT locked_by, locked_at
        FROM qa_photo_reviews
        WHERE id = ${id}
          AND locked_by IS NOT NULL
          AND locked_at > NOW() - INTERVAL '5 minutes'
      `;

      if (existingLock) {
        // Drop is locked by someone else (or lock hasn't expired)
        const lockedByCurrentUser = existingLock.locked_by === userName;

        if (lockedByCurrentUser) {
          // User already has the lock - refresh it
          await sql`
            UPDATE qa_photo_reviews
            SET locked_at = NOW()
            WHERE id = ${id}
          `;

          return res.status(200).json({
            success: true,
            data: {
              locked: true,
              lockedBy: userName,
              lockedAt: new Date().toISOString(),
            }
          });
        }

        // Locked by someone else
        return res.status(409).json({
          success: false,
          error: {
            code: 'LOCKED_BY_ANOTHER_USER',
            message: `Drop is currently being edited by ${existingLock.locked_by}`,
            lockedBy: existingLock.locked_by,
            lockedAt: existingLock.locked_at,
          }
        });
      }

      // Lock is available - acquire it
      const updatedRows = await sql`
        UPDATE qa_photo_reviews
        SET
          locked_by = ${userName},
          locked_at = NOW()
        WHERE id = ${id}
        RETURNING locked_by as "lockedBy", locked_at as "lockedAt"
      `;
      const updated = updatedRows[0]!;

      return res.status(200).json({
        success: true,
        data: {
          locked: true,
          lockedBy: updated.lockedBy,
          lockedAt: updated.lockedAt,
        }
      });

    } catch (error) {
      log.error('Error locking drop', { error });
      return res.status(500).json({
        success: false,
        error: { message: 'Failed to lock drop' }
      });
    }
  }

  return res.status(405).json({
    success: false,
    error: { message: 'Method not allowed' }
  });
}

export default withAuth(handler);
