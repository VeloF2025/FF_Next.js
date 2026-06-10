/**
 * GET /api/my/stores/technicians — list staff (technicians) for the /my stores PWA.
 *
 * PWA-session (withMySession) equivalent of GET /api/field/users. Returns the same staff
 * row shape so the existing client mapping in field-stock-pwa/api/technicians.ts is
 * unchanged. The PWA filters by role=technician; accountStatus is also supported.
 * Uses pg.Pool via @/lib/db-pool.
 *
 * Gated to stores roles via requireStoresActor. Read-only — technician creation (POST)
 * is added in Phase 2.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { requireStoresActor } from '@/modules/field-stock-pwa/lib/storesActor';

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const actor = await requireStoresActor(res, session.staffId);
  if (!actor) return;

  try {
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
  } catch (error) {
    log.error('my-stores technicians API error', { error }, 'my/stores/technicians');
    return apiResponse.internalError(res, error);
  }
});
