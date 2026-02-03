import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import {
  parseFirefliesActionItems,
  findAssigneeEmail,
} from '@/services/action-items/actionItemsParser';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Extract action items from a meeting's summary
 * POST /api/action-items/extract
 * Body: { meeting_id: number }
 *
 * Access Control: User must be a participant of the meeting (or super_admin)
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get user info for access control
  const authReq = req as AuthenticatedNextApiRequest;
  const userEmail = authReq.user?.email?.toLowerCase();
  const userRole = authReq.user?.role;
  const isSuperAdmin = userRole === 'super_admin';

  if (!userEmail) {
    return res.status(403).json({ error: 'User email required for meeting access' });
  }

  try {
    const { meeting_id } = req.body;

    if (!meeting_id) {
      return apiResponse.validationError(res, {
        meeting_id: 'Meeting ID is required',
      });
    }

    // Fetch meeting with action items - check participant access
    const [meeting] = isSuperAdmin
      ? await sql`
          SELECT id, summary, participants
          FROM meetings
          WHERE id = ${meeting_id}
        `
      : await sql`
          SELECT id, summary, participants
          FROM meetings
          WHERE id = ${meeting_id}
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(participants) AS p
            WHERE LOWER(p->>'email') = ${userEmail}
          )
        `;

    if (!meeting) {
      return res.status(403).json({ error: 'Meeting not found or not authorized to access' });
    }

    // Check if action items exist in summary
    const actionItemsText = meeting.summary?.action_items;
    if (!actionItemsText) {
      return apiResponse.success(res, [], 'No action items found in meeting summary');
    }

    // Parse action items
    const parsedItems = parseFirefliesActionItems(actionItemsText);

    // Check for existing action items from this meeting
    const existing = await sql`
      SELECT COUNT(*)::int as count
      FROM meeting_action_items
      WHERE meeting_id = ${meeting_id}
    `;

    if (existing[0]?.count > 0) {
      return apiResponse.validationError(res, {
        meeting_id: `Action items already extracted for meeting ${meeting_id}`,
      });
    }

    // Insert action items
    const inserted = [];
    for (const item of parsedItems) {
      const assignee_email = findAssigneeEmail(item.assignee, meeting.participants);

      const [created] = await sql`
        INSERT INTO meeting_action_items (
          meeting_id,
          description,
          assignee_name,
          assignee_email,
          mentioned_at,
          status,
          priority
        ) VALUES (
          ${meeting_id},
          ${item.description},
          ${item.assignee},
          ${assignee_email || null},
          ${item.mentioned_at || null},
          'pending',
          'medium'
        )
        RETURNING *
      `;

      inserted.push(created);
    }

    return apiResponse.created(
      res,
      inserted,
      `Extracted ${inserted.length} action items from meeting`
    );
  } catch (error: any) {
    console.error('Error extracting action items:', error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
