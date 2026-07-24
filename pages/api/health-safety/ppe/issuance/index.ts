/**
 * H&S PPE Issuance API
 *
 * GET  /api/health-safety/ppe/issuance - List issues (filters: project_id,
 *      contractor_id, status=outstanding) with replacement status
 * POST /api/health-safety/ppe/issuance - Issue PPE to a worker (with ack signature)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import { captureESignature } from '@/modules/health-safety/services/esignature';
import { PPE_DUE_SOON_DAYS } from '@/modules/health-safety/types/ppe.types';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res);
      case 'POST':
        return handlePost(req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
    }
  } catch (error) {
    log.error('[H&S PPE Issuance API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : null;
  const contractorId = typeof req.query.contractor_id === 'string' ? req.query.contractor_id : null;
  // "outstanding" = replacement overdue OR acknowledgement not yet signed.
  const outstandingOnly = req.query.status === 'outstanding';

  const rows = await sql`
    SELECT
      i.*, c.name AS item_name, c.category, p.project_name,
      (i.replacement_due - CURRENT_DATE) AS days_to_due,
      CASE
        WHEN i.replacement_due IS NULL THEN 'no_schedule'
        WHEN i.replacement_due < CURRENT_DATE THEN 'overdue'
        WHEN i.replacement_due <= CURRENT_DATE + make_interval(days => ${PPE_DUE_SOON_DAYS}) THEN 'due_soon'
        ELSE 'ok'
      END AS replacement_status,
      (i.signature_name IS NOT NULL) AS acknowledged
    FROM hs_ppe_issuance i
    JOIN hs_ppe_catalogue c ON c.id = i.ppe_item_id
    LEFT JOIN projects p ON p.id = i.project_id
    WHERE (${projectId}::uuid IS NULL OR i.project_id = ${projectId}::uuid)
      AND (${contractorId}::uuid IS NULL OR i.contractor_id = ${contractorId}::uuid)
      AND (
        ${outstandingOnly} = false OR
        i.signature_name IS NULL OR
        (i.replacement_due IS NOT NULL AND i.replacement_due < CURRENT_DATE)
      )
    ORDER BY i.replacement_due ASC NULLS LAST, i.issued_date DESC
  `;

  const stats = {
    total: rows.length,
    overdue: rows.filter((r) => r.replacement_status === 'overdue').length,
    due_soon: rows.filter((r) => r.replacement_status === 'due_soon').length,
    unacknowledged: rows.filter((r) => r.acknowledged === false).length,
  };

  return apiResponse.success(res, { issuance: rows, stats });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const { ppe_item_id, staff_id, team_member_id, contractor_id, project_id, size, quantity, issued_date, signature_name, notes } =
    req.body;
  const worker_name = typeof req.body.worker_name === 'string' ? req.body.worker_name.trim() : '';

  if (!ppe_item_id || !issued_date || !worker_name) {
    return apiResponse.badRequest(res, 'ppe_item_id, issued_date and worker_name are required');
  }
  if (staff_id && team_member_id) {
    return apiResponse.badRequest(res, 'A worker is staff OR a team member, not both');
  }
  const qty = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;

  const [item] = await sql`SELECT id, name, lifespan_months FROM hs_ppe_catalogue WHERE id = ${ppe_item_id} LIMIT 1`;
  if (!item) {
    return apiResponse.badRequest(res, 'Unknown ppe_item_id');
  }

  const sig =
    signature_name && typeof signature_name === 'string' && signature_name.trim().length > 0
      ? captureESignature(req, signature_name, user, new Date())
      : null;

  // replacement_due derives from the catalogue lifespan (server-side date math).
  const rows = await sql`
    INSERT INTO hs_ppe_issuance (
      ppe_item_id, staff_id, team_member_id, contractor_id, worker_name,
      project_id, size, quantity, issued_date, replacement_due,
      signature_name, signed_at, signed_by, signed_ip, notes, created_by
    ) VALUES (
      ${ppe_item_id}, ${staff_id || null}, ${team_member_id || null}, ${contractor_id || null}, ${worker_name},
      ${project_id || null}, ${size || null}, ${qty}, ${issued_date},
      CASE WHEN ${item.lifespan_months ?? null}::int IS NOT NULL
        THEN (${issued_date}::date + make_interval(months => ${item.lifespan_months ?? 0}))::date
        ELSE NULL END,
      ${sig?.signature_name ?? null}, ${sig?.signed_at ?? null}::timestamptz, ${sig?.signed_by ?? null}, ${sig?.signed_ip ?? null},
      ${notes || null}, ${user?.id ?? null}
    )
    RETURNING *
  `;

  await logHsActivity({
    activityType: 'ppe_issued',
    entityType: 'ppe_issuance',
    entityId: rows[0]!.id as string,
    description: `PPE issued: ${item.name} to ${worker_name}${sig ? ' (acknowledged)' : ''}`,
    metadata: { quantity: qty, acknowledged: sig != null },
    user,
  });

  return apiResponse.created(res, rows[0]);
}

export default withAuth(handler);
