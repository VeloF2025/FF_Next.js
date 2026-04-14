import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { MancoActionItem } from '@/types/manco-action-items.types';
import { log } from '@/lib/logger';
import { sql, query } from '@/lib/db-pool';

/** Columns accepted by the PATCH handler. */
const PATCHABLE_COLUMNS = [
  'action_item',
  'department',
  'logged_date',
  'completion_eta',
  'completion_date',
  'responsible_person',
  'fibreflow_dev',
  'fibreflow_module',
  'fibreflow_link',
  'fibreflow_responsible',
  'fibreflow_priority',
  'fibreflow_dev_status',
  'comment',
  'status',
  'is_ongoing',
  'reference_link',
  'document_url',
  'document_name',
] as const;

type PatchableColumn = (typeof PATCHABLE_COLUMNS)[number];

/** Fields that carry a URL value and must pass format validation. */
const URL_FIELDS: PatchableColumn[] = ['reference_link'];

/**
 * Returns an error string when the value is a non-null, non-http(s) string.
 * Returns null when the value is null/undefined (clearing is allowed) or valid.
 */
function validateUrl(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return `${fieldName} must be a string`;
  if (!value.startsWith('http://') && !value.startsWith('https://')) {
    return `${fieldName} must start with http:// or https://`;
  }
  return null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'ID is required');
  }

  // ------------------------------------------------------------------ GET ---
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

  // ---------------------------------------------------------------- PATCH ---
  if (req.method === 'PATCH') {
    try {
      const body = req.body as Record<string, unknown>;

      // Validate URL fields that are explicitly included in the request.
      for (const field of URL_FIELDS) {
        if (field in body) {
          const urlError = validateUrl(body[field], field);
          if (urlError) {
            return apiResponse.badRequest(res, urlError);
          }
        }
      }

      /**
       * Build SET clause dynamically from only the keys present in the request
       * body. This allows null to clear a field (fix for the COALESCE bug):
       *   - Key absent → column is NOT included → keeps existing DB value.
       *   - Key present with null → SET col = NULL → clears the value.
       *   - Key present with value → SET col = $N → updates the value.
       */
      const setClauses: string[] = [];
      const values: unknown[] = [];

      for (const col of PATCHABLE_COLUMNS) {
        if (col in body) {
          values.push(body[col] ?? null);
          setClauses.push(`${col} = $${values.length}`);
        }
      }

      if (setClauses.length === 0) {
        return apiResponse.badRequest(res, 'No updatable fields provided');
      }

      // Always bump updated_at.
      setClauses.push('updated_at = NOW()');

      // Append id as the final parameter for the WHERE clause.
      values.push(id);
      const whereParam = `$${values.length}`;

      const queryText = `
        UPDATE manco_action_items
        SET ${setClauses.join(', ')}
        WHERE id = ${whereParam}::uuid
        RETURNING *
      `;

      // 🟢 WORKING: dynamic SET — only present keys are updated.
      const rows = await query(queryText, values) as unknown as MancoActionItem[];
      const item = rows[0];

      if (!item) {
        return apiResponse.notFound(res, 'Item not found');
      }

      return apiResponse.success(res, item);
    } catch (error: unknown) {
      log.error('Error updating manco action item', { error, id });
      return apiResponse.internalError(res, error);
    }
  }

  // --------------------------------------------------------------- DELETE ---
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
