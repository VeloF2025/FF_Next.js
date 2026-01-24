import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { syncFirefliesToNeon } from '@/services/fireflies/firefliesService';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    try {
      // Fetch meetings from Neon
      const meetings = await sql`
        SELECT
          id,
          fireflies_id,
          title,
          meeting_date as date,
          duration,
          transcript_url,
          summary,
          participants,
          created_at,
          updated_at
        FROM meetings
        ORDER BY meeting_date DESC
        LIMIT 50
      `;

      return res.status(200).json({ meetings });
    } catch (error: any) {
      console.error('Error fetching meetings:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === 'POST' && req.query.action === 'sync') {
    try {
      const apiKey = process.env.FIREFLIES_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ error: 'FIREFLIES_API_KEY not configured' });
      }

      const count = await syncFirefliesToNeon(apiKey, sql);

      return res.status(200).json({
        success: true,
        synced: count,
        message: `Synced ${count} meetings from Fireflies`
      });
    } catch (error: any) {
      console.error('Error syncing from Fireflies:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(handler);
