import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import {
  MancoActionItem,
  MancoActionItemFilters,
} from '@/types/manco-action-items.types';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    try {
      const {
        status,
        department,
        responsible_person,
        search,
      } = req.query as Partial<Record<keyof MancoActionItemFilters, string>>;

      let items: unknown[];

      if (status && department && responsible_person && search) {
        items = await sql`
          SELECT * FROM manco_action_items
          WHERE status = ${status}
            AND department = ${department}
            AND responsible_person = ${responsible_person}
            AND (action_item ILIKE ${'%' + search + '%'} OR comment ILIKE ${'%' + search + '%'})
          ORDER BY completion_eta ASC NULLS LAST, created_at DESC
        `;
      } else if (status && department && responsible_person) {
        items = await sql`
          SELECT * FROM manco_action_items
          WHERE status = ${status}
            AND department = ${department}
            AND responsible_person = ${responsible_person}
          ORDER BY completion_eta ASC NULLS LAST, created_at DESC
        `;
      } else if (status && department && search) {
        items = await sql`
          SELECT * FROM manco_action_items
          WHERE status = ${status}
            AND department = ${department}
            AND (action_item ILIKE ${'%' + search + '%'} OR comment ILIKE ${'%' + search + '%'})
          ORDER BY completion_eta ASC NULLS LAST, created_at DESC
        `;
      } else if (status && responsible_person && search) {
        items = await sql`
          SELECT * FROM manco_action_items
          WHERE status = ${status}
            AND responsible_person = ${responsible_person}
            AND (action_item ILIKE ${'%' + search + '%'} OR comment ILIKE ${'%' + search + '%'})
          ORDER BY completion_eta ASC NULLS LAST, created_at DESC
        `;
      } else if (department && responsible_person && search) {
        items = await sql`
          SELECT * FROM manco_action_items
          WHERE department = ${department}
            AND responsible_person = ${responsible_person}
            AND (action_item ILIKE ${'%' + search + '%'} OR comment ILIKE ${'%' + search + '%'})
          ORDER BY completion_eta ASC NULLS LAST, created_at DESC
        `;
      } else if (status && department) {
        items = await sql`
          SELECT * FROM manco_action_items
          WHERE status = ${status}
            AND department = ${department}
          ORDER BY completion_eta ASC NULLS LAST, created_at DESC
        `;
      } else if (status && responsible_person) {
        items = await sql`
          SELECT * FROM manco_action_items
          WHERE status = ${status}
            AND responsible_person = ${responsible_person}
          ORDER BY completion_eta ASC NULLS LAST, created_at DESC
        `;
      } else if (status && search) {
        items = await sql`
          SELECT * FROM manco_action_items
          WHERE status = ${status}
            AND (action_item ILIKE ${'%' + search + '%'} OR comment ILIKE ${'%' + search + '%'})
          ORDER BY completion_eta ASC NULLS LAST, created_at DESC
        `;
      } else if (department && responsible_person) {
        items = await sql`
          SELECT * FROM manco_action_items
          WHERE department = ${department}
            AND responsible_person = ${responsible_person}
          ORDER BY completion_eta ASC NULLS LAST, created_at DESC
        `;
      } else if (department && search) {
        items = await sql`
          SELECT * FROM manco_action_items
          WHERE department = ${department}
            AND (action_item ILIKE ${'%' + search + '%'} OR comment ILIKE ${'%' + search + '%'})
          ORDER BY completion_eta ASC NULLS LAST, created_at DESC
        `;
      } else if (responsible_person && search) {
        items = await sql`
          SELECT * FROM manco_action_items
          WHERE responsible_person = ${responsible_person}
            AND (action_item ILIKE ${'%' + search + '%'} OR comment ILIKE ${'%' + search + '%'})
          ORDER BY completion_eta ASC NULLS LAST, created_at DESC
        `;
      } else if (status) {
        items = await sql`
          SELECT * FROM manco_action_items
          WHERE status = ${status}
          ORDER BY completion_eta ASC NULLS LAST, created_at DESC
        `;
      } else if (department) {
        items = await sql`
          SELECT * FROM manco_action_items
          WHERE department = ${department}
          ORDER BY completion_eta ASC NULLS LAST, created_at DESC
        `;
      } else if (responsible_person) {
        items = await sql`
          SELECT * FROM manco_action_items
          WHERE responsible_person = ${responsible_person}
          ORDER BY completion_eta ASC NULLS LAST, created_at DESC
        `;
      } else if (search) {
        items = await sql`
          SELECT * FROM manco_action_items
          WHERE action_item ILIKE ${'%' + search + '%'} OR comment ILIKE ${'%' + search + '%'}
          ORDER BY completion_eta ASC NULLS LAST, created_at DESC
        `;
      } else {
        items = await sql`
          SELECT * FROM manco_action_items
          ORDER BY completion_eta ASC NULLS LAST, created_at DESC
        `;
      }

      return apiResponse.success(res, items as MancoActionItem[]);
    } catch (error: unknown) {
      log.error('Error fetching manco action items', { error });
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'POST') {
    try {
      const {
        action_item,
        department,
        logged_date,
        completion_eta,
        responsible_person,
        fibreflow_dev,
        fibreflow_module,
        fibreflow_responsible,
        fibreflow_dev_status,
        comment,
        status,
        reference_link,
        document_url,
        document_name,
      } = req.body;

      if (!action_item || !status) {
        return apiResponse.badRequest(res, 'action_item and status are required');
      }

      const ffDev = !!fibreflow_dev;
      const statusStr = String(status);

      const [item] = await sql`
        INSERT INTO manco_action_items (
          action_item, department, logged_date, completion_eta, responsible_person,
          fibreflow_dev, fibreflow_module, fibreflow_responsible, fibreflow_dev_status,
          comment, status, reference_link, document_url, document_name
        ) VALUES (
          ${action_item}, ${department}, ${logged_date}, ${completion_eta}, ${responsible_person},
          ${ffDev}, ${fibreflow_module}, ${fibreflow_responsible}, ${fibreflow_dev_status},
          ${comment}, ${statusStr}, ${reference_link ?? null}, ${document_url ?? null}, ${document_name ?? null}
        )
        RETURNING *
      `;

      res.status(201);
      return apiResponse.success(res, item as unknown as MancoActionItem);
    } catch (error: unknown) {
      log.error('Error creating manco action item', { error });
      return apiResponse.internalError(res, error);
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(handler);
