import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // TODO: Replace with proper Clerk auth when ready for production
  // For now, use a test user ID for development
  const userId = 'dev-user-1';

  try {
    if (req.method === 'GET') {
      // Get all reminders for user
      const { status, limit = '100' } = req.query;

      let query = `
        SELECT * FROM reminders
        WHERE user_id = $1
      `;

      const params: any[] = [userId];

      if (status) {
        query += ` AND status = $2`;
        params.push(status);
      }

      query += ` ORDER BY
        CASE priority
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
        END,
        due_date ASC NULLS LAST,
        created_at DESC
        LIMIT $${params.length + 1}
      `;
      params.push(parseInt(limit as string));

      const reminders = await sql(query, params);

      return res.status(200).json({
        success: true,
        data: reminders
      });
    }

    if (req.method === 'POST') {
      // Create new reminder
      const { title, description, due_date, priority = 'medium' } = req.body;

      if (!title) {
        return res.status(400).json({
          success: false,
          error: 'Title is required'
        });
      }

      const result = await sql`
        INSERT INTO reminders (user_id, title, description, due_date, priority)
        VALUES (${userId}, ${title}, ${description || null}, ${due_date || null}, ${priority})
        RETURNING *
      `;

      return res.status(201).json({
        success: true,
        data: result[0]
      });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('Reminders API error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

export default withAuth(handler);
