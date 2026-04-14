/**
 * GET /api/action-items/my-items
 *
 * Returns action items assigned to the authenticated user.
 * Matches on assigned_to_user_id (UUID link) OR assignee_email (legacy fuzzy match).
 * Ordered by status priority, then due_date, then created_at.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { ActionItem } from '@/types/action-items.types';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthenticatedNextApiRequest;
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const authUser = authReq.user;
  const userId = authUser.id;
  const userEmail = authUser.email?.toLowerCase() ?? '';

  try {
    // Use explicit query branches to satisfy Neon's no-conditional-SQL-fragment rule.
    // When email is present: match on assigned_to_user_id (UUID index, preferred) OR
    //   assignee_email (legacy records predating migration 256 may lack the UUID link).
    // When email is absent: match on UUID only to avoid false positives from empty-string
    //   comparisons against rows that also have an empty assignee_email.
    const items = userEmail
      ? await sql`
          SELECT
            ai.id,
            ai.meeting_id,
            ai.description,
            ai.assignee_name,
            ai.assignee_email,
            ai.status::text,
            ai.priority::text,
            ai.due_date,
            ai.completed_date,
            ai.mentioned_at,
            ai.created_at,
            ai.updated_at,
            ai.tags,
            ai.notes,
            ai.assigned_to_user_id,
            ai.source_type,
            ai.source_id,
            ai.project_id,
            ai.category,
            m.title  AS meeting_title,
            m.meeting_date,
            m.transcript_url,
            u.first_name || ' ' || u.last_name AS assigned_user_name,
            u.profile_picture   AS assigned_user_avatar
          FROM action_items ai
          LEFT JOIN meetings m ON ai.meeting_id = m.id
          LEFT JOIN users u ON ai.assigned_to_user_id = u.id
          WHERE
            ai.assigned_to_user_id = ${userId}::uuid
            OR LOWER(ai.assignee_email) = ${userEmail}
          ORDER BY
            CASE
              WHEN ai.status::text = 'pending'     THEN 1
              WHEN ai.status::text = 'in_progress' THEN 2
              WHEN ai.status::text = 'completed'   THEN 3
              ELSE 4
            END,
            ai.due_date ASC NULLS LAST,
            ai.created_at DESC
          LIMIT 200
        `
      : await sql`
          SELECT
            ai.id,
            ai.meeting_id,
            ai.description,
            ai.assignee_name,
            ai.assignee_email,
            ai.status::text,
            ai.priority::text,
            ai.due_date,
            ai.completed_date,
            ai.mentioned_at,
            ai.created_at,
            ai.updated_at,
            ai.tags,
            ai.notes,
            ai.assigned_to_user_id,
            ai.source_type,
            ai.source_id,
            ai.project_id,
            ai.category,
            m.title  AS meeting_title,
            m.meeting_date,
            m.transcript_url,
            u.first_name || ' ' || u.last_name AS assigned_user_name,
            u.profile_picture   AS assigned_user_avatar
          FROM action_items ai
          LEFT JOIN meetings m ON ai.meeting_id = m.id
          LEFT JOIN users u ON ai.assigned_to_user_id = u.id
          WHERE
            ai.assigned_to_user_id = ${userId}::uuid
          ORDER BY
            CASE
              WHEN ai.status::text = 'pending'     THEN 1
              WHEN ai.status::text = 'in_progress' THEN 2
              WHEN ai.status::text = 'completed'   THEN 3
              ELSE 4
            END,
            ai.due_date ASC NULLS LAST,
            ai.created_at DESC
          LIMIT 200
        `;

    return apiResponse.success(res, items as unknown as ActionItem[]);
  } catch (error: unknown) {
    log.error('Error fetching my action items', { error, userId }, 'ActionItemsMyItems');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
