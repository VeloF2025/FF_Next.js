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

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { role, accountStatus } = req.query as { role?: string; accountStatus?: string };

  let rows: Record<string, unknown>[];
  if (role && accountStatus) {
    rows = await sql`
      SELECT id, first_name, last_name, phone, email, role, account_status,
             created_by_staff_id, created_at
      FROM staff
      WHERE role = ${role} AND account_status = ${accountStatus}
      ORDER BY created_at DESC
      LIMIT 200
    `;
  } else if (role) {
    rows = await sql`
      SELECT id, first_name, last_name, phone, email, role, account_status,
             created_by_staff_id, created_at
      FROM staff
      WHERE role = ${role}
      ORDER BY created_at DESC
      LIMIT 200
    `;
  } else if (accountStatus) {
    rows = await sql`
      SELECT id, first_name, last_name, phone, email, role, account_status,
             created_by_staff_id, created_at
      FROM staff
      WHERE account_status = ${accountStatus}
      ORDER BY created_at DESC
      LIMIT 200
    `;
  } else {
    rows = await sql`
      SELECT id, first_name, last_name, phone, email, role, account_status,
             created_by_staff_id, created_at
      FROM staff
      ORDER BY created_at DESC
      LIMIT 200
    `;
  }

  return apiResponse.success(res, rows);
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
      RETURNING id, role, account_status, created_by_staff_id
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
