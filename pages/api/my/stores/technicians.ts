/**
 * /api/my/stores/technicians — list + create technicians for the /my stores PWA.
 *
 * PWA-session (withMySession) equivalent of /api/field/users, scoped to the stores
 * audience:
 *   GET  — list staff (the PWA filters by role=technician; accountStatus also supported).
 *   POST — create a technician. A stores actor is never admin-tier, so this mirrors the
 *          non-admin path of /api/field/users exactly: role is locked to 'technician' and
 *          the account is created `pending` (an admin must approve before activation).
 *          created_by_staff_id is the acting stores person (session.staffId) directly —
 *          no users.id lookup, since /my identities are staff ids.
 *
 * Uses pg.Pool via @/lib/db-pool. Gated to stores roles via requireStoresActor.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { requireStoresActor, type StoresActor } from '@/modules/field-stock-pwa/lib/storesActor';
import { findExistingStaffForRegistration } from '@/services/staff/staffPhoneDedup';
import { resolveStaffSite, matchStaffToStore } from '@/modules/field-stock-pwa/lib/staffSite';

/** Reject a malformed project id rather than letting Postgres raise on the cast. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { role, roles, accountStatus, storeLocationId } = req.query as {
    role?: string;
    roles?: string;
    accountStatus?: string;
    storeLocationId?: string;
  };

  // `roles` (csv) supersedes the older single `role`. The picker needs BOTH
  // technicians and casuals: casuals receive stock like anyone else, and the
  // single-role param silently excluded all ten of them from the list.
  const roleList = roles
    ? roles.split(',').map((r) => r.trim()).filter(Boolean)
    : role
      ? [role]
      : null;

  // Resolve the store's site HERE rather than trusting a client-supplied
  // project id: the server owns the warehouse->project mapping, and a caller
  // that passed the wrong project would filter the list against the wrong site.
  //
  // A store is only comparable once it has been mapped (migration 514). An
  // unmapped store resolves to null, every row comes back 'unmapped-store', and
  // the picker shows everyone — never filter against a site we cannot determine.
  let storeProject: string | null = null;
  if (storeLocationId && UUID_SHAPE.test(storeLocationId)) {
    const loc = await sql`SELECT project_id FROM stock_locations WHERE id = ${storeLocationId}`;
    storeProject = (loc[0]?.project_id as string | null) ?? null;
  }

  // One query, no conditional SQL fragments: this repo's tagged-template tag
  // mis-handles `${cond ? sql`...` : sql``}`, so absent filters are expressed
  // as NULL parameters instead of as branches.
  const rows = await sql`
    SELECT s.id, s.first_name, s.last_name, s.phone, s.email, s.role, s.account_status,
           s.created_by_staff_id, s.created_at,
           s.assigned_project_id, ap.project_name AS assigned_project_name,
           s.declared_project_id, dp.project_name AS declared_project_name
    FROM staff s
    LEFT JOIN projects ap ON ap.id = s.assigned_project_id
    LEFT JOIN projects dp ON dp.id = s.declared_project_id
    WHERE (${roleList}::text[] IS NULL OR s.role = ANY(${roleList}::text[]))
      AND (${accountStatus ?? null}::text IS NULL OR s.account_status = ${accountStatus ?? null})
    ORDER BY s.created_at DESC
    LIMIT 200
  `;

  // Site resolution and matching live in staffSite.ts so the server and the
  // picker cannot drift on what "works at this site" means.
  const annotated = rows.map((r) => {
    const site = resolveStaffSite({
      assignedProjectId: (r.assigned_project_id as string | null) ?? null,
      assignedProjectName: (r.assigned_project_name as string | null) ?? null,
      declaredProjectId: (r.declared_project_id as string | null) ?? null,
      declaredProjectName: (r.declared_project_name as string | null) ?? null,
    });
    return {
      ...r,
      site_project_id: site.projectId,
      site_project_name: site.projectName,
      site_source: site.source,
      site_match: matchStaffToStore(site, storeProject),
    };
  });

  return apiResponse.success(res, annotated);
}

async function handlePost(req: NextApiRequest, res: NextApiResponse, actor: StoresActor) {
  const { firstName, lastName, phone, role } = req.body as {
    firstName?: string;
    lastName?: string;
    phone?: string;
    role?: string;
  };

  if (!firstName || !lastName || !phone) {
    return apiResponse.badRequest(res, 'firstName, lastName and phone are required');
  }
  // Stores actors may only create technicians (non-admin path). Any other role is rejected.
  if (role !== undefined && role !== 'technician') {
    return apiResponse.forbidden(res, 'Stores users may only create technician accounts');
  }

  // Phone dedup: a staff row with this phone already exists → return it instead
  // of inserting a duplicate. Duplicates split identity (custody lands on one
  // row, the phone-keyed /my OTP login resolves another). The existing row is
  // returned regardless of its role — issuing stock to an existing 'stores' or
  // 'office' person is correct; silently downgrading them to technician is not.
  try {
    const existing = await findExistingStaffForRegistration(phone, firstName, lastName);
    if (existing) {
      log.info(
        'my-stores technician create matched existing staff by phone',
        { id: existing.id, createdBy: actor.staffId },
        'my/stores/technicians',
      );
      return apiResponse.success(res, { user: existing, existing: true });
    }
  } catch (error) {
    // Dedup is a guard, not a gate — log and fall through to the INSERT.
    log.error('my-stores technician phone dedup failed', { error }, 'my/stores/technicians');
  }

  const employeeId = `TECH-${String(Date.now()).slice(-8)}`;
  // staff.email is NOT NULL UNIQUE but contractor techs often have no real email.
  // Synthetic `@phone.local` address, matching /api/field/users — not a real domain,
  // so downstream real-email filters can grep it out.
  const resolvedEmail = `${phone}@phone.local`;

  try {
    const rows = await sql`
      INSERT INTO staff (
        employee_id, first_name, last_name, email, phone, status,
        department, position, contract_type,
        role, account_status, created_by_staff_id
      )
      VALUES (
        ${employeeId}, ${firstName}, ${lastName}, ${resolvedEmail}, ${phone}, 'active',
        'Field Operations', 'Technician', 'contractor',
        'technician', 'pending', ${actor.staffId}
      )
      RETURNING id, first_name, last_name, role, account_status, created_by_staff_id
    `;

    const created = rows[0];
    log.info('my-stores technician created', { id: created?.id, createdBy: actor.staffId }, 'my/stores/technicians');
    return apiResponse.created(res, { user: created }, 'Technician created successfully');
  } catch (error) {
    log.error('my-stores technician create error', { error }, 'my/stores/technicians');
    return apiResponse.internalError(res, error);
  }
}

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  const actor = await requireStoresActor(res, session.staffId);
  if (!actor) return;

  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res, actor);
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  } catch (error) {
    log.error('my-stores technicians API error', { error }, 'my/stores/technicians');
    return apiResponse.internalError(res, error);
  }
});
