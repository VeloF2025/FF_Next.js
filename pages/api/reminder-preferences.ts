import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = (req as any).user?.id;
  const email = (req as any).user?.email;
  if (!userId) return apiResponse.unauthorized(res);

  try {

    if (req.method === 'GET') {
      // Get user preferences (create default if doesn't exist)
      let preferences = await sql`
        SELECT id, user_id, email, enabled, send_time, timezone, created_at, updated_at
        FROM reminder_preferences
        WHERE user_id = ${userId}
      `;

      if (preferences.length === 0) {
        // Create default preferences with email
        preferences = await sql`
          INSERT INTO reminder_preferences (user_id, email)
          VALUES (${userId}, ${email})
          RETURNING id, user_id, email, enabled, send_time, timezone, created_at, updated_at
        `;
      } else if (!preferences[0]!.email && email) {
        // Update existing preference with email if missing
        preferences = await sql`
          UPDATE reminder_preferences
          SET email = ${email}, updated_at = NOW()
          WHERE user_id = ${userId}
          RETURNING id, user_id, email, enabled, send_time, timezone, created_at, updated_at
        `;
      }

      return res.status(200).json({
        success: true,
        data: preferences[0]
      });
    }

    if (req.method === 'PUT') {
      // Update preferences
      const { enabled, send_time, timezone } = req.body;

      const updates: string[] = [];
      const params: any[] = [userId];
      let paramIndex = 2;

      if (enabled !== undefined) {
        updates.push(`enabled = $${paramIndex++}`);
        params.push(enabled);
      }
      if (send_time !== undefined) {
        updates.push(`send_time = $${paramIndex++}`);
        params.push(send_time);
      }
      if (timezone !== undefined) {
        updates.push(`timezone = $${paramIndex++}`);
        params.push(timezone);
      }

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No fields to update'
        });
      }

      updates.push(`updated_at = NOW()`);

      const query = `
        INSERT INTO reminder_preferences (user_id)
        VALUES ($1)
        ON CONFLICT (user_id)
        DO UPDATE SET ${updates.join(', ')}
        RETURNING id, user_id, email, enabled, send_time, timezone, created_at, updated_at
      `;

      const result = await sql(query, params);

      return res.status(200).json({
        success: true,
        data: result[0]
      });
    }

    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'PUT']);
  } catch (error) {
    log.error('Reminder preferences API error', { error });
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

export default withAuth(handler);
