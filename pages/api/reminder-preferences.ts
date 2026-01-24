import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // TODO: Replace with proper Clerk auth when ready for production
  const userId = 'dev-user-1';
  const email = 'ai@velocityfibre.co.za'; // TODO: Get from Clerk when ready

  try {

    if (req.method === 'GET') {
      // Get user preferences (create default if doesn't exist)
      let preferences = await sql`
        SELECT * FROM reminder_preferences
        WHERE user_id = ${userId}
      `;

      if (preferences.length === 0) {
        // Create default preferences with email
        preferences = await sql`
          INSERT INTO reminder_preferences (user_id, email)
          VALUES (${userId}, ${email})
          RETURNING *
        `;
      } else if (!preferences[0].email && email) {
        // Update existing preference with email if missing
        preferences = await sql`
          UPDATE reminder_preferences
          SET email = ${email}, updated_at = NOW()
          WHERE user_id = ${userId}
          RETURNING *
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
        RETURNING *
      `;

      const result = await sql(query, params);

      return res.status(200).json({
        success: true,
        data: result[0]
      });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('Reminder preferences API error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

export default withAuth(handler);
