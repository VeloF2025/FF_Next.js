import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { ActionItemUpdateInput } from '@/types/action-items.types';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.validationError(res, { id: 'Invalid action item ID' });
  }

  // GET - Fetch single action item
  if (req.method === 'GET') {
    try {
      const item = await sql`
        SELECT
          ai.*,
          m.title as meeting_title,
          m.meeting_date,
          m.transcript_url
        FROM meeting_action_items ai
        LEFT JOIN meetings m ON ai.meeting_id = m.id
        WHERE ai.id = ${id}
      `;

      if (!item || item.length === 0) {
        return apiResponse.notFound(res, 'Action item', id);
      }

      return apiResponse.success(res, item[0]);
    } catch (error: any) {
      log.error('Error fetching action item', { error });
      return apiResponse.internalError(res, error);
    }
  }

  // PATCH - Update action item
  if (req.method === 'PATCH') {
    try {
      const updates: ActionItemUpdateInput = req.body;

      // Build dynamic SET clause
      const setClauses: string[] = ['updated_at = NOW()'];
      const fields: Record<string, any> = {};

      if (updates.description !== undefined) {
        fields.description = updates.description;
      }
      if (updates.assignee_name !== undefined) {
        fields.assignee_name = updates.assignee_name;
      }
      if (updates.assignee_email !== undefined) {
        fields.assignee_email = updates.assignee_email;
      }
      if (updates.status !== undefined) {
        fields.status = updates.status;
        // Auto-set completed_date when status changes to completed
        if (updates.status === 'completed' && !updates.completed_date) {
          fields.completed_date = new Date().toISOString();
        }
      }
      if (updates.priority !== undefined) {
        fields.priority = updates.priority;
      }
      if (updates.due_date !== undefined) {
        fields.due_date = updates.due_date;
      }
      if (updates.completed_date !== undefined) {
        fields.completed_date = updates.completed_date;
      }
      if (updates.tags !== undefined) {
        fields.tags = updates.tags;
      }
      if (updates.notes !== undefined) {
        fields.notes = updates.notes;
      }

      if (Object.keys(fields).length === 0) {
        return apiResponse.validationError(res, { updates: 'No fields to update' });
      }

      // Neon serverless ONLY accepts tagged templates
      // Build conditional update based on what fields are provided
      let result;

      if (fields.status !== undefined) {
        // Most common case - status update
        result = await sql`
          UPDATE meeting_action_items
          SET
            status = ${fields.status},
            completed_date = ${fields.completed_date || null},
            updated_at = NOW()
          WHERE id = ${id}
          RETURNING *
        `;
      } else if (fields.description !== undefined) {
        result = await sql`
          UPDATE meeting_action_items
          SET
            description = ${fields.description},
            updated_at = NOW()
          WHERE id = ${id}
          RETURNING *
        `;
      } else if (fields.assignee_name !== undefined || fields.assignee_email !== undefined) {
        result = await sql`
          UPDATE meeting_action_items
          SET
            assignee_name = ${fields.assignee_name || null},
            assignee_email = ${fields.assignee_email || null},
            updated_at = NOW()
          WHERE id = ${id}
          RETURNING *
        `;
      } else if (fields.priority !== undefined) {
        result = await sql`
          UPDATE meeting_action_items
          SET
            priority = ${fields.priority},
            updated_at = NOW()
          WHERE id = ${id}
          RETURNING *
        `;
      } else if (fields.due_date !== undefined) {
        result = await sql`
          UPDATE meeting_action_items
          SET
            due_date = ${fields.due_date},
            updated_at = NOW()
          WHERE id = ${id}
          RETURNING *
        `;
      } else if (fields.tags !== undefined) {
        result = await sql`
          UPDATE meeting_action_items
          SET
            tags = ${fields.tags},
            updated_at = NOW()
          WHERE id = ${id}
          RETURNING *
        `;
      } else if (fields.notes !== undefined) {
        result = await sql`
          UPDATE meeting_action_items
          SET
            notes = ${fields.notes},
            updated_at = NOW()
          WHERE id = ${id}
          RETURNING *
        `;
      } else {
        // Fallback - just update timestamp
        result = await sql`
          UPDATE meeting_action_items
          SET updated_at = NOW()
          WHERE id = ${id}
          RETURNING *
        `;
      }

      if (!result || result.length === 0) {
        return apiResponse.notFound(res, 'Action item', id);
      }

      return apiResponse.success(res, result[0], 'Action item updated successfully');
    } catch (error: any) {
      log.error('Error updating action item', { error });
      return apiResponse.internalError(res, error);
    }
  }

  // DELETE - Delete action item
  if (req.method === 'DELETE') {
    try {
      const [deleted] = await sql`
        DELETE FROM meeting_action_items
        WHERE id = ${id}
        RETURNING id
      `;

      if (!deleted) {
        return apiResponse.notFound(res, 'Action item', id);
      }

      return apiResponse.success(res, { id: deleted.id }, 'Action item deleted successfully');
    } catch (error: any) {
      log.error('Error deleting action item', { error });
      return apiResponse.internalError(res, error);
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(handler);
