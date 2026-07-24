/**
 * H&S Permit detail API
 *
 * GET    /api/health-safety/permits/[permitId] - Permit + type + effective status
 * PATCH  /api/health-safety/permits/[permitId] - Edit / confirm preconditions / transition status
 * DELETE /api/health-safety/permits/[permitId] - Delete a permit
 *
 * Status transitions and expiry are enforced here, server-side (§7.4): an
 * expired permit's allowed-transition set is empty, so it cannot be activated
 * or reused; approval requires every mandatory precondition confirmed.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import {
  effectivePermitStatus,
  checkTransition,
  allMandatoryPreconditionsMet,
  TERMINAL_PERMIT_STATUSES,
} from '@/modules/health-safety/services/permitService';
import type { PermitStatus, PermitPrecondition } from '@/modules/health-safety/types/permit.types';
import { withHsPermission } from '@/modules/health-safety/services/hsAuth';

/** Fields a PATCH may edit; used to detect an edit attempt on a terminal permit. */
const EDITABLE_FIELDS = ['title', 'work_description', 'location', 'valid_from', 'valid_to', 'notes', 'precondition_confirmed'];

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { permitId } = req.query;
  if (!permitId || typeof permitId !== 'string') {
    return apiResponse.badRequest(res, 'permitId is required');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(permitId, res);
      case 'PATCH':
        return handlePatch(permitId, req, res);
      case 'DELETE':
        return handleDelete(permitId, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PATCH', 'DELETE']);
    }
  } catch (error) {
    log.error('[H&S Permit Detail API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function loadPermit(permitId: string) {
  const [permit] = await sql`
    SELECT pm.*, t.name AS type_name, t.code AS type_code, t.preconditions, p.project_name
    FROM hs_permits pm
    JOIN hs_permit_types t ON t.id = pm.permit_type_id
    LEFT JOIN projects p ON p.id = pm.project_id
    WHERE pm.id = ${permitId}
  `;
  return permit;
}

async function handleGet(permitId: string, res: NextApiResponse) {
  const permit = await loadPermit(permitId);
  if (!permit) {
    return apiResponse.notFound(res, 'Permit', permitId);
  }
  const effective = effectivePermitStatus(permit.status as PermitStatus, permit.valid_to as string | null, new Date());
  return apiResponse.success(res, { permit: { ...permit, effective_status: effective } });
}

async function handlePatch(permitId: string, req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const permit = await loadPermit(permitId);
  if (!permit) {
    return apiResponse.notFound(res, 'Permit', permitId);
  }

  const { status, precondition_confirmed, title, work_description, location, valid_from, valid_to, notes } = req.body;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(req.body, k);

  const preconditions = Array.isArray(permit.preconditions) ? (permit.preconditions as PermitPrecondition[]) : [];
  // The confirmed set this request will persist (updated value if supplied).
  const confirmed = has('precondition_confirmed') && Array.isArray(precondition_confirmed)
    ? precondition_confirmed.filter((t: unknown) => typeof t === 'string')
    : (Array.isArray(permit.precondition_confirmed) ? (permit.precondition_confirmed as string[]) : []);

  const effective = effectivePermitStatus(permit.status as PermitStatus, permit.valid_to as string | null, new Date());

  // A terminal permit (closed/expired/rejected) is a finished safety-file record:
  // its fields — including which preconditions were confirmed — must not be
  // rewritten from the API even though a status change is already blocked. The
  // one write we still allow is persisting the lapse (approved/active → expired).
  const attemptsFieldEdit = EDITABLE_FIELDS.some((f) => has(f));
  if (TERMINAL_PERMIT_STATUSES.includes(effective) && attemptsFieldEdit) {
    return apiResponse.badRequest(res, `Cannot edit a ${effective} permit`);
  }

  if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
    return apiResponse.badRequest(res, 'title cannot be empty');
  }
  if (valid_from && valid_to && String(valid_to) < String(valid_from)) {
    return apiResponse.badRequest(res, 'valid_to cannot be before valid_from');
  }

  // Status transition (if requested) is validated against the EFFECTIVE status.
  let newStatus = permit.status as PermitStatus;
  if (status && status !== permit.status) {
    const check = checkTransition(effective, status as PermitStatus, { allPreconditionsMet: allMandatoryPreconditionsMet(preconditions, confirmed) });
    if (!check.ok) {
      return apiResponse.badRequest(res, check.reason!);
    }
    newStatus = status as PermitStatus;
  } else if (effective === 'expired' && permit.status !== 'expired') {
    // Persist the lapse so the stored status stops lying, even on a plain edit.
    newStatus = 'expired';
  }

  const approving = newStatus === 'approved' && permit.status !== 'approved';

  const rows = await sql`
    UPDATE hs_permits
    SET
      status = ${newStatus},
      precondition_confirmed = ${JSON.stringify(confirmed)}::jsonb,
      title = COALESCE(${title ?? null}, title),
      work_description = CASE WHEN ${has('work_description')} THEN ${work_description ?? null} ELSE work_description END,
      location = CASE WHEN ${has('location')} THEN ${location ?? null} ELSE location END,
      valid_from = CASE WHEN ${has('valid_from')} THEN ${valid_from ?? null}::timestamptz ELSE valid_from END,
      valid_to = CASE WHEN ${has('valid_to')} THEN ${valid_to ?? null}::timestamptz ELSE valid_to END,
      notes = CASE WHEN ${has('notes')} THEN ${notes ?? null} ELSE notes END,
      approved_by = CASE WHEN ${approving} THEN ${user?.id ?? null}::uuid ELSE approved_by END,
      approved_at = CASE WHEN ${approving} THEN NOW() ELSE approved_at END,
      updated_at = NOW()
    WHERE id = ${permitId}
    RETURNING *
  `;

  await logHsActivity({
    activityType: status && status !== permit.status ? `permit_${newStatus}` : 'permit_updated',
    entityType: 'permit',
    entityId: permitId,
    description: `Permit ${permit.permit_number} ${status && status !== permit.status ? `→ ${newStatus}` : 'updated'}`,
    metadata: { from: permit.status, to: newStatus },
    user,
  });

  return apiResponse.success(res, rows[0]);
}

async function handleDelete(permitId: string, req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const rows = await sql`DELETE FROM hs_permits WHERE id = ${permitId} RETURNING id, permit_number`;
  if (rows.length === 0) {
    return apiResponse.notFound(res, 'Permit', permitId);
  }

  await logHsActivity({
    activityType: 'permit_deleted',
    entityType: 'permit',
    entityId: permitId,
    description: `Permit deleted: ${rows[0]!.permit_number}`,
    user,
  });

  return apiResponse.success(res, { deleted: true, id: permitId });
}

export default withHsPermission(handler);
