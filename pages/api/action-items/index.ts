import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { resolveActionItemAccess } from '@/lib/actionItems/meetingAccess';
import { buildActionItemListQuery } from '@/lib/actionItems/listQuery';
import pool from '@/lib/db';
import { ActionItem, ActionItemCreateInput } from '@/types/action-items.types';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';

async function handleList(req: NextApiRequest, res: NextApiResponse) {
  const resolved = resolveActionItemAccess((req as AuthenticatedNextApiRequest).user);
  if ('error' in resolved) return apiResponse.forbidden(res, resolved.error);

  const built = buildActionItemListQuery(req.query, resolved.access);
  if ('error' in built) return apiResponse.badRequest(res, built.error);

  const result = await pool.query(built.text, built.params);
  return apiResponse.success(res, result.rows as unknown as ActionItem[]);
}

async function handleCreate(req: NextApiRequest, res: NextApiResponse) {
  const resolved = resolveActionItemAccess((req as AuthenticatedNextApiRequest).user);
  if ('error' in resolved) return apiResponse.forbidden(res, resolved.error);

  const input: ActionItemCreateInput = req.body;

  if (!input.description) {
    return apiResponse.validationError(res, {
      description: 'Description is required',
    });
  }

  // Attaching an item to a meeting is a claim about that meeting. Someone who cannot READ a
  // meeting must not be able to write into it either — otherwise create becomes a way to
  // probe which meeting ids exist and to inject content the real attendees will see.
  if (input.meeting_id && !resolved.access.isOwner) {
    const attended = await pool.query(
      `SELECT 1 FROM meetings m
        WHERE m.id = $1
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(m.participants, '[]'::jsonb)) AS p
            WHERE LOWER(p->>'email') = $2
          )
        LIMIT 1`,
      [input.meeting_id, resolved.access.email],
    );
    if (attended.rowCount === 0) {
      return apiResponse.forbidden(res, 'Meeting not found or not authorized to access');
    }
  }

  const [item] = await sql`
    INSERT INTO action_items (
      meeting_id, description, assignee_name, assignee_email, status, priority,
      due_date, mentioned_at, tags, notes, assigned_to_user_id, source_type,
      source_id, project_id, category
    ) VALUES (
      ${input.meeting_id || null},
      ${input.description},
      ${input.assignee_name || null},
      ${input.assignee_email || null},
      ${input.status || 'pending'},
      ${input.priority || 'medium'},
      ${input.due_date || null},
      ${input.mentioned_at || null},
      ${input.tags || null},
      ${input.notes || null},
      ${input.assigned_to_user_id || null},
      ${input.source_type || 'meeting'},
      ${input.source_id || null},
      ${input.project_id || null},
      ${input.category || null}
    )
    RETURNING *
  `;

  return apiResponse.created(res, item, 'Action item created successfully');
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') return await handleList(req, res);
    if (req.method === 'POST') return await handleCreate(req, res);
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET', 'POST']);
  } catch (error: unknown) {
    log.error('Action items request failed', {
      module: 'action-items',
      method: req.method,
      error: (error as Error).message,
    });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
