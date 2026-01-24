import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import {
  parseFirefliesActionItems,
  findAssigneeEmail,
} from '@/services/action-items/actionItemsParser';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Extract action items from ALL meetings that have them
 * POST /api/action-items/extract-all
 *
 * This endpoint is called by:
 * - Vercel cron job (every 6 hours)
 * - Manual sync button (future feature)
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[Extract All] Starting bulk extraction...');

    // Find all meetings with action items
    const meetings = await sql`
      SELECT id, title, summary, participants
      FROM meetings
      WHERE summary IS NOT NULL
      AND summary->>'action_items' IS NOT NULL
      AND summary->>'action_items' != ''
    `;

    console.log(`[Extract All] Found ${meetings.length} meetings with action items`);

    let extracted = 0;
    let skipped = 0;
    let errors: Array<{ meeting_id: number; title: string; error: string }> = [];

    for (const meeting of meetings) {
      try {
        // Check if already extracted
        const existing = await sql`
          SELECT COUNT(*)::int as count
          FROM meeting_action_items
          WHERE meeting_id = ${meeting.id}
        `;

        if (existing[0]?.count > 0) {
          skipped++;
          continue;
        }

        // Parse action items
        const actionItemsText = meeting.summary?.action_items;
        if (!actionItemsText) {
          continue;
        }

        const parsedItems = parseFirefliesActionItems(actionItemsText);

        // Insert action items
        for (const item of parsedItems) {
          const assignee_email = findAssigneeEmail(item.assignee, meeting.participants);

          await sql`
            INSERT INTO meeting_action_items (
              meeting_id,
              description,
              assignee_name,
              assignee_email,
              mentioned_at,
              status,
              priority
            ) VALUES (
              ${meeting.id},
              ${item.description},
              ${item.assignee},
              ${assignee_email || null},
              ${item.mentioned_at || null},
              'pending',
              'medium'
            )
          `;

          extracted++;
        }

        console.log(`[Extract All] ✅ ${meeting.title}: ${parsedItems.length} items`);
      } catch (error: any) {
        console.error(`[Extract All] ❌ ${meeting.title}:`, error.message);
        errors.push({
          meeting_id: meeting.id,
          title: meeting.title,
          error: error.message,
        });
      }
    }

    const result = {
      total_meetings: meetings.length,
      extracted: extracted,
      skipped: skipped,
      errors: errors.length,
      error_details: errors,
    };

    console.log('[Extract All] Complete:', result);

    return apiResponse.success(
      res,
      result,
      `Extracted ${extracted} action items from ${meetings.length - skipped - errors.length} meetings`
    );
  } catch (error: any) {
    console.error('[Extract All] Fatal error:', error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
