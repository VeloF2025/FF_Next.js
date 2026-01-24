import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import {
  ActionItem,
  ActionItemCreateInput,
  ActionItemFilters,
  ActionItemStats,
} from '@/types/action-items.types';

const sql = neon(process.env.DATABASE_URL!);

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
        priority,
        search,
        overdue,
      } = req.query as Partial<Record<keyof ActionItemFilters, string>>;

      // Simple approach: Fetch all and filter in code
      // This is acceptable for moderate datasets (<10k items)
      let items = await sql`
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
          m.title as meeting_title,
          m.meeting_date,
          m.transcript_url
        FROM meeting_action_items ai
        LEFT JOIN meetings m ON ai.meeting_id = m.id
        ORDER BY
          CASE
            WHEN ai.status::text = 'pending' THEN 1
            WHEN ai.status::text = 'in_progress' THEN 2
            WHEN ai.status::text = 'completed' THEN 3
            WHEN ai.status::text = 'cancelled' THEN 4
          END,
          ai.created_at DESC
        LIMIT 500
      `;

      // Apply filters in JavaScript
      if (status) {
        const statuses = status.split(',');
        items = items.filter(item => statuses.includes(item.status));
      }

      if (assignee_name) {
        const search = assignee_name.toLowerCase();
        items = items.filter(item => item.assignee_name?.toLowerCase().includes(search));
      }

      if (meeting_id) {
        const id = parseInt(meeting_id);
        items = items.filter(item => item.meeting_id === id);
      }

      if (priority) {
        items = items.filter(item => item.priority === priority);
      }

      if (search) {
        const searchLower = search.toLowerCase();
        items = items.filter(item => item.description?.toLowerCase().includes(searchLower));
      }

      if (overdue === 'true') {
        const now = new Date();
        items = items.filter(item =>
          item.due_date &&
          new Date(item.due_date) < now &&
          item.status !== 'completed'
        );
      }

      // Limit results
      items = items.slice(0, 100);

      return apiResponse.success(res, items as ActionItem[]);
    } catch (error: any) {
      console.error('Error fetching action items:', error);
      return apiResponse.internalError(res, error);
    }
  }

  // POST - Create new action item
  if (req.method === 'POST') {
    try {
      const input: ActionItemCreateInput = req.body;

      if (!input.meeting_id || !input.description) {
        return apiResponse.validationError(res, {
          meeting_id: !input.meeting_id ? 'Meeting ID is required' : undefined,
          description: !input.description ? 'Description is required' : undefined,
        });
      }

      const [item] = await sql`
        INSERT INTO meeting_action_items (
          meeting_id,
          description,
          assignee_name,
          assignee_email,
          status,
          priority,
          due_date,
          mentioned_at,
          tags,
          notes
        ) VALUES (
          ${input.meeting_id},
          ${input.description},
          ${input.assignee_name || null},
          ${input.assignee_email || null},
          ${input.status || 'pending'},
          ${input.priority || 'medium'},
          ${input.due_date || null},
          ${input.mentioned_at || null},
          ${input.tags || null},
          ${input.notes || null}
        )
        RETURNING *
      `;

      return apiResponse.created(res, item, 'Action item created successfully');
    } catch (error: any) {
      console.error('Error creating action item:', error);
      return apiResponse.internalError(res, error);
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(handler);
