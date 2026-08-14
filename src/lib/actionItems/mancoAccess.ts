/**
 * Per-method permission for the manco action-item routes.
 *
 * Both routes were `withAuth` and nothing else, so any authenticated user could edit or
 * delete any of the 37 management-committee items. The table has no ownership column —
 * no created_by, no updated_by, only free-text `responsible_person` — so there is no
 * basis in the data for a per-item rule.
 *
 * There is no need to invent one. `dashboard.action-items` already carries per-ACTION
 * grants that encode the intended policy, and the routes were simply not consulting them:
 *
 *   view    all roles except storeman        84 active users
 *   edit    manager, technician, admin, sa   42
 *   delete  admin, super_admin               16
 *
 * So today a `viewer` — 52 of the 84 — can edit items they are only meant to read, and
 * 78 people can delete what 16 are meant to be able to delete. Applying the existing
 * grants is a policy decision that was already taken, not a new one.
 *
 * Checked per method rather than with `withPermission`, which fixes one action at wrap
 * time; a route serving GET, PATCH and DELETE needs three different answers.
 */

import { userHasPermission } from '@/lib/permissions';
import type { PermissionAction } from '@/lib/permissions';

/** The key the sidebar already gates the Action Items page on. */
export const MANCO_PERMISSION = 'dashboard.action-items';

/**
 * The action a request method requires.
 *
 * Anything unrecognised maps to the STRICTEST action rather than to a default, so a
 * method added later fails closed instead of inheriting read access.
 */
export function actionForMethod(method: string | undefined): PermissionAction {
  switch ((method ?? '').toUpperCase()) {
    case 'GET':
    case 'HEAD':
      return 'view';
    case 'POST':
      return 'create';
    case 'PATCH':
    case 'PUT':
      return 'edit';
    default:
      return 'delete';
  }
}

export type MancoAccessResult =
  | { ok: true }
  | { ok: false; status: 403; message: string }
  | { ok: false; status: 500; message: string };

/**
 * Resolve whether this caller may perform this method.
 *
 * The DB error is caught here rather than left to bubble: `withAuth` returns the handler
 * promise without awaiting it, so a rejection becomes an unhandled one with nothing
 * logged and a bare 500. Failing closed on an error is deliberate — an access check that
 * cannot run has not passed.
 */
export async function checkMancoAccess(
  userId: string,
  method: string | undefined,
): Promise<MancoAccessResult> {
  const action = actionForMethod(method);
  try {
    const allowed = await userHasPermission(userId, MANCO_PERMISSION, action);
    return allowed
      ? { ok: true }
      : { ok: false, status: 403, message: `You do not have ${action} access to action items.` };
  } catch {
    return { ok: false, status: 500, message: 'Could not verify your access.' };
  }
}
