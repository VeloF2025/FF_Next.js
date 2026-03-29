import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { MancoActionItem } from '@/types/manco-action-items.types';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'ID is required');
  }

  if (req.method === 'GET') {
    try {
      const [item] = await sql`
        SELECT * FROM manco_action_items WHERE id = ${id}::uuid
      `;

      if (!item) {
        return apiResponse.notFound(res, 'Item not found');
      }

      return apiResponse.success(res, item as unknown as MancoActionItem);
    } catch (error: unknown) {
      log.error('Error fetching manco action item', { error, id });
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'PATCH') {
    try {
      const {
        action_item,
        department,
        logged_date,
        completion_eta,
        completion_date,
        responsible_person,
        fibreflow_dev,
        fibreflow_module,
        fibreflow_link,
        fibreflow_responsible,
        fibreflow_priority,
        fibreflow_dev_status,
        comment,
        status,
        is_ongoing,
      } = req.body;

      const [item] = await sql`
        UPDATE manco_action_items
        SET
          action_item = COALESCE(${action_item}, action_item),
          department = COALESCE(${department}, department),
          logged_date = COALESCE(${logged_date}, logged_date),
          completion_eta = COALESCE(${completion_eta}, completion_eta),
          completion_date = COALESCE(${completion_date}, completion_date),
          responsible_person = COALESCE(${responsible_person}, responsible_person),
          fibreflow_dev = COALESCE(${fibreflow_dev}, fibreflow_dev),
          fibreflow_module = COALESCE(${fibreflow_module}, fibreflow_module),
          fibreflow_link = COALESCE(${fibreflow_link}, fibreflow_link),
          fibreflow_responsible = COALESCE(${fibreflow_responsible}, fibreflow_responsible),
          fibreflow_priority = COALESCE(${fibreflow_priority}, fibreflow_priority),
          fibreflow_dev_status = COALESCE(${fibreflow_dev_status}, fibreflow_dev_status),
          comment = COALESCE(${comment}, comment),
          status = COALESCE(${status}, status),
          is_ongoing = COALESCE(${is_ongoing}, is_ongoing),
          updated_at = NOW()
        WHERE id = ${id}::uuid
        RETURNING *
      `;

      if (!item) {
        return apiResponse.notFound(res, 'Item not found');
      }

      return apiResponse.success(res, item as unknown as MancoActionItem);
    } catch (error: unknown) {
      log.error('Error updating manco action item', { error, id });
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'DELETE') {
    try {
      await sql`DELETE FROM manco_action_items WHERE id = ${id}::uuid`;
      return apiResponse.success(res, { deleted: true });
    } catch (error: unknown) {
      log.error('Error deleting manco action item', { error, id });
      return apiResponse.internalError(res, error);
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(handler);
