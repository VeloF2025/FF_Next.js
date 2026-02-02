import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { syncFirefliesToNeon } from '@/services/fireflies/firefliesService';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Get user email for participant filtering
  const authReq = req as AuthenticatedNextApiRequest;
  const userEmail = authReq.user?.email?.toLowerCase();

  if (!userEmail) {
    return res.status(403).json({ error: 'User email required for meeting access' });
  }

  if (req.method === 'GET') {
    try {
      // Check if requesting a specific meeting by ID
      const { id } = req.query;

      if (id) {
        // Fetch specific meeting - only if user is a participant
        const [meeting] = await sql`
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
          WHERE id = ${id}
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(participants) AS p
            WHERE LOWER(p->>'email') = ${userEmail}
          )
        `;

        if (!meeting) {
          return res.status(403).json({ error: 'Not authorized to view this meeting' });
        }

        return res.status(200).json({ meeting });
      }

      // Fetch all meetings where user's email appears in participants array
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
        WHERE EXISTS (
          SELECT 1 FROM jsonb_array_elements(participants) AS p
          WHERE LOWER(p->>'email') = ${userEmail}
        )
        ORDER BY meeting_date DESC
        LIMIT 50
      `;

      return res.status(200).json({ meetings });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('Error fetching meetings:', { error: errorMessage, userEmail });
      return res.status(500).json({ error: errorMessage });
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
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('Error syncing from Fireflies:', { error: errorMessage });
      return res.status(500).json({ error: errorMessage });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(handler);
