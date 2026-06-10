/**
 * storesActor — server-side actor resolution + role gate for /my/stores/* API routes.
 *
 * The /my stores PWA authenticates via withMySession (ff_my_session cookie), which
 * hands the handler an AttendanceSession carrying `staffId` directly. The existing
 * main-RBAC (withAuth) procurement endpoints instead derive the actor from
 * `req.user.id` via `staff JOIN users ON u.id = s.user_id`. This helper gives the
 * /my routes the same actor context — { staffId, staffRole, authRole, name } —
 * resolved straight from the staff row, then applies the shared stores role gate.
 *
 * LEFT JOIN users (not INNER): PIN-only field staff have no `user_id` link, so
 * `authRole` is null and authorisation falls back to the staff.role check.
 *
 * Uses pg.Pool via @/lib/db-pool — new lookups must not extend the Neon-shim surface.
 */

import type { NextApiResponse } from 'next';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { isStoresAuthorised } from './storesRoles';
import type { StaffRole } from '@/modules/attendance/portal/types';

export interface StoresActor {
  /** staff.id — the canonical PWA identity (FK target for /my data). */
  staffId: string;
  /** staff.role — null when the column is not yet populated for legacy rows. */
  staffRole: StaffRole | null;
  /** users.role (AuthRole) via staff.user_id; null for PIN-only staff. */
  authRole: string | null;
  /** Display name, "First Last" trimmed. */
  name: string;
}

/**
 * Resolve the actor context for a staff id. Returns null when no staff row exists.
 */
export async function resolveStoresActor(staffId: string): Promise<StoresActor | null> {
  const rows = await sql`
    SELECT s.id, s.role, u.role AS auth_role, s.first_name, s.last_name
    FROM staff s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.id = ${staffId}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;

  return {
    staffId: row.id as string,
    staffRole: (row.role as StaffRole | null) ?? null,
    authRole: (row.auth_role as string | null) ?? null,
    name: `${(row.first_name as string | null) ?? ''} ${(row.last_name as string | null) ?? ''}`.trim(),
  };
}

/**
 * Resolve + gate the actor for a /my/stores route. On any failure — DB error,
 * missing staff row, or insufficient role — writes the appropriate error to `res`
 * and returns null; callers must `return` immediately when this returns null. On
 * success returns the authorised StoresActor.
 *
 * The DB lookup is wrapped here so route handlers can call this BEFORE their own
 * try/catch without a resolution failure escaping as an unhandled 500.
 *
 * Gate: staff.role in STORES_ROLES ('stores' | 'admin'), OR authRole in
 * STORES_AUTH_ROLES ('super_admin' | 'system') — see isStoresAuthorised.
 */
export async function requireStoresActor(
  res: NextApiResponse,
  staffId: string,
): Promise<StoresActor | null> {
  let actor: StoresActor | null;
  try {
    actor = await resolveStoresActor(staffId);
  } catch (error) {
    log.error('requireStoresActor resolution failed', { error, staffId }, 'field-stock-pwa/storesActor');
    apiResponse.internalError(res, error);
    return null;
  }

  if (!actor) {
    apiResponse.forbidden(res, 'No staff record for session');
    return null;
  }

  if (!isStoresAuthorised(actor.staffRole, actor.authRole)) {
    apiResponse.forbidden(res, 'Insufficient role to access stores');
    return null;
  }

  return actor;
}
