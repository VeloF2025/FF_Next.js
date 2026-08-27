/**
 * QA Centre Delivery Tree API
 *
 * GET /api/construction-qa/delivery-tree
 *   ?projectId=UUID            optional — restrict to one project
 *   &opticalSubmittedOnly=1    optional — only PONs with a port submission
 *
 * Read-only projection of Project → Zone → PON delivery status. Zone status
 * comes from active handover certificates, PON status from the recorded port
 * submission; both rules live in the delivery-tree module, not in this route.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { buildDeliveryTree } from '@/modules/construction-qa/delivery-tree/buildDeliveryTree';
import type { DeliveryTreeQueryRow } from '@/modules/construction-qa/delivery-tree/types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Raw shape as node-postgres returns it: timestamps as Date, ints as number. */
interface RawRow {
  project_id: string;
  project_name: string;
  zone_no: number;
  pon_no: number;
  poles_total: number;
  poles_planted: number;
  activation_total: number;
  activation_complete: number;
  port_submitted_at: Date | string | null;
  has_active_fac: boolean | null;
  has_active_cac: boolean | null;
}

// Zone certificates are per project + zone, so they are aggregated once and
// joined rather than correlated per PON row.
const BASE_QUERY = `
  SELECT
    t.project_id,
    p.project_name,
    t.zone_no,
    t.pon_no,
    COALESCE(t.poles_total, 0)::int AS poles_total,
    COALESCE(t.poles_planted, 0)::int AS poles_planted,
    COALESCE(t.activation_total, 0)::int AS activation_total,
    COALESCE(t.activation_complete, 0)::int AS activation_complete,
    d.port_submitted_at,
    COALESCE(z.has_active_fac, FALSE) AS has_active_fac,
    COALESCE(z.has_active_cac, FALSE) AS has_active_cac
  FROM pon_stage_tracking t
  JOIN projects p ON p.id = t.project_id
  LEFT JOIN pon_delivery_state d ON d.pon_stage_id = t.id
  LEFT JOIN (
    SELECT
      project_id,
      zone_no,
      bool_or(document_type = 'fac' AND superseded_at IS NULL) AS has_active_fac,
      bool_or(document_type = 'cac' AND superseded_at IS NULL) AS has_active_cac
    FROM zone_delivery_documents
    GROUP BY project_id, zone_no
  ) z ON z.project_id = t.project_id AND z.zone_no = t.zone_no
`;

const ORDER_BY = ' ORDER BY p.project_name, t.zone_no, t.pon_no';

const iso = (value: Date | string | null): string | null => {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const toQueryRow = (row: RawRow): DeliveryTreeQueryRow => ({
  project_id: row.project_id,
  project_name: row.project_name,
  zone_no: Number(row.zone_no),
  pon_no: Number(row.pon_no),
  poles_total: Number(row.poles_total),
  poles_planted: Number(row.poles_planted),
  activation_total: Number(row.activation_total),
  activation_complete: Number(row.activation_complete),
  port_submitted_at: iso(row.port_submitted_at),
  hasActiveFac: row.has_active_fac === true,
  hasActiveCac: row.has_active_cac === true,
});

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  const rawProjectId = req.query.projectId;
  const projectId = typeof rawProjectId === 'string' && rawProjectId !== '' ? rawProjectId : null;
  if (projectId !== null && !UUID_PATTERN.test(projectId)) {
    return apiResponse.badRequest(res, 'projectId must be a UUID');
  }

  const rawFlag = req.query.opticalSubmittedOnly;
  const opticalSubmittedOnly = rawFlag === '1' || rawFlag === 'true';

  // Explicit query branches — conditional tagged-template SQL fragments are
  // broken in this codebase, so each filter combination builds its own text.
  const conditions: string[] = [];
  const params: string[] = [];
  if (projectId !== null) {
    params.push(projectId);
    conditions.push(`t.project_id = $${params.length}::uuid`);
  }
  if (opticalSubmittedOnly) {
    conditions.push('d.port_submitted_at IS NOT NULL');
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await pool.query<RawRow>(`${BASE_QUERY}${where}${ORDER_BY}`, params);
    return apiResponse.success(res, buildDeliveryTree(result.rows.map(toQueryRow)));
  } catch (error) {
    log.error('Delivery tree API error', {
      module: 'construction-qa',
      projectId,
      opticalSubmittedOnly,
      error: (error as Error).message,
    });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withPermission('construction-qa.qa-centre')(handler));
