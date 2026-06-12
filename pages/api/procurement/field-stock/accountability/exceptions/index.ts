/**
 * Stock Exceptions List API
 * GET /api/procurement/field-stock/accountability/exceptions
 *
 * Returns held serials cross-checked against OES/WA activation evidence from the
 * v_holder_stock_exceptions view (migration 410), classified as:
 *   cross_dr_conflict | installed_not_cleared | aged_no_evidence | recent_no_evidence
 *
 * By default only the three EXCEPTION classes are returned; recent_no_evidence
 * (normal in-field stock) is excluded unless ?includeAll=true.
 *
 * Optional filters (all parameterized):
 *   ?holderId=<uuid>   → one holder
 *   ?projectId=<uuid>  → one project (use 'unassigned' for NULL project)
 *   ?class=<className> → one exception class
 *   ?includeAll=true   → also include recent_no_evidence
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const EXCEPTION_CLASSES = ['cross_dr_conflict', 'installed_not_cleared', 'aged_no_evidence'] as const;
const ALL_CLASSES = [...EXCEPTION_CLASSES, 'recent_no_evidence'] as const;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    const { holderId, projectId, class: cls, includeAll } = req.query;

    const conditions: string[] = [];
    const params: unknown[] = [];

    // Class scope: a specific class, or the default exception set, or all.
    if (typeof cls === 'string' && (ALL_CLASSES as readonly string[]).includes(cls)) {
      params.push(cls);
      conditions.push(`exception_class = $${params.length}`);
    } else if (includeAll !== 'true') {
      params.push(EXCEPTION_CLASSES as readonly string[]);
      conditions.push(`exception_class = ANY($${params.length}::text[])`);
    }

    if (typeof holderId === 'string') {
      params.push(holderId);
      conditions.push(`holder_id = $${params.length}`);
    }

    if (typeof projectId === 'string') {
      if (projectId === 'unassigned') {
        conditions.push('project_id IS NULL');
      } else {
        params.push(projectId);
        conditions.push(`project_id = $${params.length}`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await query(
      `SELECT
        serial_id, serial_number, status,
        holder_id, holder_type, holder_name,
        stock_item_id, item_code, item_name,
        project_id, project_name,
        held_since, held_days,
        wa_drop, oes_drop, oes_status, oes_activation_date,
        exception_class
       FROM v_holder_stock_exceptions
       ${whereClause}
       ORDER BY
         CASE exception_class
           WHEN 'cross_dr_conflict' THEN 0
           WHEN 'installed_not_cleared' THEN 1
           WHEN 'aged_no_evidence' THEN 2
           ELSE 3
         END,
         held_days DESC,
         holder_name`,
      params
    );

    return apiResponse.success(res, rows);
  } catch (error: unknown) {
    log.error('Error listing stock exceptions', { error }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
