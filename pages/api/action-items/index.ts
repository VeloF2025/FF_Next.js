import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import {
  ActionItem,
  ActionItemCreateInput,
  ActionItemFilters,
} from '@/types/action-items.types';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // GET - List action items with filters
  if (req.method === 'GET') {
    try {
      const {
        status,
        assignee_name,
        meeting_id,
        project_id,
        priority,
        search,
        overdue,
        assigned_to_user_id,
        source_type,
      } = req.query as Partial<Record<keyof ActionItemFilters, string>>;

      const meetingIdNum = meeting_id ? parseInt(meeting_id) : null;

      // No conditional SQL fragments — use separate query branches per the project rules.
      // SQL-level filters used for indexed columns (meeting_id, project_id, assigned_to_user_id);
      // remaining filters applied in JS to avoid dynamic fragment issues with Neon.
      let items;

      if (meetingIdNum && project_id) {
        items = await sql`
          SELECT
            ai.id, ai.meeting_id, ai.description, ai.assignee_name, ai.assignee_email,
            ai.status::text, ai.priority::text, ai.due_date, ai.completed_date,
            ai.mentioned_at, ai.created_at, ai.updated_at, ai.tags, ai.notes,
            ai.assigned_to_user_id, ai.source_type, ai.source_id, ai.project_id, ai.category,
            m.title as meeting_title, m.meeting_date, m.transcript_url,
            u.first_name || ' ' || u.last_name as assigned_user_name, u.profile_picture as assigned_user_avatar
          FROM action_items ai
          LEFT JOIN meetings m ON ai.meeting_id = m.id
          LEFT JOIN users u ON ai.assigned_to_user_id = u.id
          WHERE ai.meeting_id = ${meetingIdNum}
            AND ai.project_id = ${project_id}::uuid
          ORDER BY
            CASE WHEN ai.status::text = 'pending' THEN 1 WHEN ai.status::text = 'in_progress' THEN 2
                 WHEN ai.status::text = 'completed' THEN 3 ELSE 4 END,
            ai.created_at DESC
        `;
      } else if (meetingIdNum) {
        items = await sql`
          SELECT
            ai.id, ai.meeting_id, ai.description, ai.assignee_name, ai.assignee_email,
            ai.status::text, ai.priority::text, ai.due_date, ai.completed_date,
            ai.mentioned_at, ai.created_at, ai.updated_at, ai.tags, ai.notes,
            ai.assigned_to_user_id, ai.source_type, ai.source_id, ai.project_id, ai.category,
            m.title as meeting_title, m.meeting_date, m.transcript_url,
            u.first_name || ' ' || u.last_name as assigned_user_name, u.profile_picture as assigned_user_avatar
          FROM action_items ai
          LEFT JOIN meetings m ON ai.meeting_id = m.id
          LEFT JOIN users u ON ai.assigned_to_user_id = u.id
          WHERE ai.meeting_id = ${meetingIdNum}
          ORDER BY
            CASE WHEN ai.status::text = 'pending' THEN 1 WHEN ai.status::text = 'in_progress' THEN 2
                 WHEN ai.status::text = 'completed' THEN 3 ELSE 4 END,
            ai.created_at DESC
        `;
      } else if (assigned_to_user_id && project_id) {
        items = await sql`
          SELECT
            ai.id, ai.meeting_id, ai.description, ai.assignee_name, ai.assignee_email,
            ai.status::text, ai.priority::text, ai.due_date, ai.completed_date,
            ai.mentioned_at, ai.created_at, ai.updated_at, ai.tags, ai.notes,
            ai.assigned_to_user_id, ai.source_type, ai.source_id, ai.project_id, ai.category,
            m.title as meeting_title, m.meeting_date, m.transcript_url,
            u.first_name || ' ' || u.last_name as assigned_user_name, u.profile_picture as assigned_user_avatar
          FROM action_items ai
          LEFT JOIN meetings m ON ai.meeting_id = m.id
          LEFT JOIN users u ON ai.assigned_to_user_id = u.id
          WHERE ai.assigned_to_user_id = ${assigned_to_user_id}::uuid
            AND ai.project_id = ${project_id}::uuid
          ORDER BY
            CASE WHEN ai.status::text = 'pending' THEN 1 WHEN ai.status::text = 'in_progress' THEN 2
                 WHEN ai.status::text = 'completed' THEN 3 ELSE 4 END,
            ai.created_at DESC
          LIMIT 500
        `;
      } else if (assigned_to_user_id) {
        items = await sql`
          SELECT
            ai.id, ai.meeting_id, ai.description, ai.assignee_name, ai.assignee_email,
            ai.status::text, ai.priority::text, ai.due_date, ai.completed_date,
            ai.mentioned_at, ai.created_at, ai.updated_at, ai.tags, ai.notes,
            ai.assigned_to_user_id, ai.source_type, ai.source_id, ai.project_id, ai.category,
            m.title as meeting_title, m.meeting_date, m.transcript_url,
            u.first_name || ' ' || u.last_name as assigned_user_name, u.profile_picture as assigned_user_avatar
          FROM action_items ai
          LEFT JOIN meetings m ON ai.meeting_id = m.id
          LEFT JOIN users u ON ai.assigned_to_user_id = u.id
          WHERE ai.assigned_to_user_id = ${assigned_to_user_id}::uuid
          ORDER BY
            CASE WHEN ai.status::text = 'pending' THEN 1 WHEN ai.status::text = 'in_progress' THEN 2
                 WHEN ai.status::text = 'completed' THEN 3 ELSE 4 END,
            ai.created_at DESC
          LIMIT 500
        `;
      } else if (project_id) {
        items = await sql`
          SELECT
            ai.id, ai.meeting_id, ai.description, ai.assignee_name, ai.assignee_email,
            ai.status::text, ai.priority::text, ai.due_date, ai.completed_date,
            ai.mentioned_at, ai.created_at, ai.updated_at, ai.tags, ai.notes,
            ai.assigned_to_user_id, ai.source_type, ai.source_id, ai.project_id, ai.category,
            m.title as meeting_title, m.meeting_date, m.transcript_url,
            u.first_name || ' ' || u.last_name as assigned_user_name, u.profile_picture as assigned_user_avatar
          FROM action_items ai
          LEFT JOIN meetings m ON ai.meeting_id = m.id
          LEFT JOIN users u ON ai.assigned_to_user_id = u.id
          WHERE ai.project_id = ${project_id}::uuid
          ORDER BY
            CASE WHEN ai.status::text = 'pending' THEN 1 WHEN ai.status::text = 'in_progress' THEN 2
                 WHEN ai.status::text = 'completed' THEN 3 ELSE 4 END,
            ai.created_at DESC
          LIMIT 500
        `;
      } else {
        items = await sql`
          SELECT
            ai.id, ai.meeting_id, ai.description, ai.assignee_name, ai.assignee_email,
            ai.status::text, ai.priority::text, ai.due_date, ai.completed_date,
            ai.mentioned_at, ai.created_at, ai.updated_at, ai.tags, ai.notes,
            ai.assigned_to_user_id, ai.source_type, ai.source_id, ai.project_id, ai.category,
            m.title as meeting_title, m.meeting_date, m.transcript_url,
            u.first_name || ' ' || u.last_name as assigned_user_name, u.profile_picture as assigned_user_avatar
          FROM action_items ai
          LEFT JOIN meetings m ON ai.meeting_id = m.id
          LEFT JOIN users u ON ai.assigned_to_user_id = u.id
          ORDER BY
            CASE WHEN ai.status::text = 'pending' THEN 1 WHEN ai.status::text = 'in_progress' THEN 2
                 WHEN ai.status::text = 'completed' THEN 3 ELSE 4 END,
            ai.created_at DESC
          LIMIT 500
        `;
      }

      // Cast to a workable type for JS-level filtering — sql rows are Record<string, unknown>
      let rows = items as unknown as Record<string, unknown>[];

      // Apply remaining filters in JavaScript
      if (status) {
        const statuses = status.split(',');
        rows = rows.filter(item => statuses.includes(String(item.status ?? '')));
      }

      if (source_type) {
        rows = rows.filter(item => item.source_type === source_type);
      }

      if (assignee_name) {
        const needle = assignee_name.toLowerCase();
        rows = rows.filter(item =>
          typeof item.assignee_name === 'string' &&
          item.assignee_name.toLowerCase().includes(needle)
        );
      }

      if (priority) {
        rows = rows.filter(item => item.priority === priority);
      }

      if (search) {
        const searchLower = search.toLowerCase();
        rows = rows.filter(item =>
          typeof item.description === 'string' &&
          item.description.toLowerCase().includes(searchLower)
        );
      }

      if (overdue === 'true') {
        const now = new Date();
        rows = rows.filter(item =>
          item.due_date &&
          new Date(String(item.due_date)) < now &&
          item.status !== 'completed'
        );
      }

      // Limit final results
      rows = rows.slice(0, 100);

      return apiResponse.success(res, rows as unknown as ActionItem[]);
    } catch (error: unknown) {
      log.error('Error fetching action items', { error });
      return apiResponse.internalError(res, error);
    }
  }

  // POST - Create new action item
  if (req.method === 'POST') {
    try {
      const input: ActionItemCreateInput = req.body;

      if (!input.description) {
        return apiResponse.validationError(res, {
          description: 'Description is required',
        });
      }

      const [item] = await sql`
        INSERT INTO action_items (
          meeting_id,
          description,
          assignee_name,
          assignee_email,
          status,
          priority,
          due_date,
          mentioned_at,
          tags,
          notes,
          assigned_to_user_id,
          source_type,
          source_id,
          project_id,
          category
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
    } catch (error: unknown) {
      log.error('Error creating action item', { error });
      return apiResponse.internalError(res, error);
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(handler);
