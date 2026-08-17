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
 * Effective holders, computed the way userHasPermission resolves them — role row, then
 * user_permission_overrides, then the super_admin bypass — against 95 active users:
 *
 *   view    94   every role except storeman
 *   create  42
 *   edit    42   manager, technician, admin, super_admin
 *   delete  17   admin, super_admin, plus one manager with a grant override
 *
 * So today a `viewer` — 52 of the 95 — can edit items they are only meant to read, and
 * all 95 can delete what 17 are meant to be able to delete. Applying the existing grants
 * is a policy decision that was already taken, not a new one.
 *
 * (An earlier version of this comment said 84/42/16 of 84. Those figures counted the 10
 * super_admins out of `view` while counting them into `edit` and `delete`, and ignored
 * the override entirely. The conclusion held; the numbers did not.)
 *
 * Checked per method rather than with `withPermission`, which fixes one action at wrap
 * time; a route serving GET, PATCH and DELETE needs three different answers.
 */

import { userHasPermission } from '@/lib/permissions';
import type { PermissionAction } from '@/lib/permissions';
import { log } from '@/lib/logger';

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
    // OPTIONS is grouped with the reads: a CORS preflight asks whether a request MAY be
    // made, carries no payload and changes nothing. Mapping it to `delete` would refuse
    // it for 78 of 95 users, which reads as an auth bug rather than a policy. These
    // routes are same-origin today and set no CORS headers, so this is defensive.
    case 'GET':
    case 'HEAD':
    case 'OPTIONS':
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
    if (allowed) return { ok: true };

    // Denials are logged. This starts refusing ~52 viewers on PATCH, and without a record
    // the only evidence of a refusal is a user saying "I can't save". withPermission logs
    // its denials for the same reason.
    log.warn('Manco action item permission denied', {
      module: 'manco-action-items',
      userId,
      permission: MANCO_PERMISSION,
      action,
    });
    return {
      ok: false,
      status: 403,
      message: `You do not have ${action} access to action items.`,
    };
  } catch (error) {
    // The REAL error is logged here. Catching it was justified by "an unhandled rejection
    // is nothing logged" — swallowing it silently would have been the same outcome by a
    // different route. The caller still gets a generic message; the cause goes to the log.
    log.error('Manco action item permission check failed', {
      module: 'manco-action-items',
      userId,
      permission: MANCO_PERMISSION,
      action,
      error: (error as Error).message,
    });
    return { ok: false, status: 500, message: 'Could not verify your access.' };
  }
}
