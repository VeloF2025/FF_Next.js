/**
 * Active FibreFlow user search + name resolution for the incident settings
 * dialog's oversight-membership controls, gated on `fleet.incidents-settings:edit`
 * — the same permission the dialog itself is authorized on and the same one
 * `oversight-members.ts`/`rules.ts` already gate their mutations with.
 *
 * This exists to fix a permission-scope defect: the dialog previously called
 * `/api/admin/users` (`pages/api/admin/users/index.ts`), gated
 * `withRole('admin')`. `reviewScope.ts` explicitly supports a NON-admin user
 * holding `fleet.incidents-settings:edit` via an active override grant, so
 * such a user could open the settings dialog but got a 403 the instant they
 * searched for someone to add to oversight — the same defect class an
 * independent review caught in PR5 (a section gated on the wrong permission
 * key for its actual audience). Never returns email or any credential
 * field, and only ever matches `users.is_active = true`.
 *
 * `?search=<term>` powers the live "add member" search; `?ids=<uuid,uuid>`
 * resolves display names for existing oversight rows so they never render
 * the raw `userId` UUID (this task's secondary fix). Both go through the
 * same permission gate — there is no unscoped path to either.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { IncidentValidationError } from '@/modules/fleet/incidents/reviewValidation';
import { parseUserSearchQuery } from '@/modules/fleet/incidents/incidentSettingsValidation';
import { resolveActiveUserNames, searchActiveUsers } from '@/modules/fleet/incidents/settingsRepository';

interface Request extends NextApiRequest { user?: { id: string; role: string } }

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  try {
    const parsed = parseUserSearchQuery(req.query);
    const users = parsed.mode === 'ids' ? await resolveActiveUserNames(parsed.ids) : await searchActiveUsers(parsed.search);
    return apiResponse.success(res, { users });
  } catch (error) {
    if (error instanceof IncidentValidationError) return apiResponse.badRequest(res, error.message);
    log.error('Failed to search Fleet incident settings users', { error, method: req.method }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  return withPermission('fleet.incidents-settings', 'edit')(handler)(req, res);
}
export default withAuth(route);
