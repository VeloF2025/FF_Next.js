/**
 * Permission and project-scope resolution for Fleet incident review,
 * built on `fleet/operations/projectScope.ts`'s `hasOperationalOversight`
 * for the `fleet.incidents`/`fleet.incidents-settings` permissions
 * (design §14).
 *
 * `hasOperationalOversight` is parameterized on permission key and action
 * (see its call with `'fleet.operations-rules'` in
 * `pages/api/fleet/operations/rules.ts`), so this module calls it directly
 * rather than duplicating its (base permission AND (admin role OR an
 * active per-user grant override)) pattern — so a generic `manager` role —
 * which the migration (499) grants base `fleet.incidents` access to, but
 * NOT `fleet.incidents-settings` (that one is admin/super_admin only) —
 * never gains cross-project or projectless reach without an explicit
 * admin role or override grant.
 *
 * `isProjectOwnedByScope` below is NOT similarly reused from
 * `projectScope.ts`: that module's project-scope helpers deliberately
 * filter to `status = 'active'` projects only, but incident review must
 * still reach historical/closed projects, so this omits that filter on
 * purpose — kept as its own query rather than forced through a helper that
 * would silently exclude closed-project incidents.
 */
import { query, queryOne } from '@/lib/db-pool';
import { userHasPermission } from '@/lib/permissions';
import { hasOperationalOversight } from '../operations/projectScope';

export const FLEET_INCIDENTS_PERMISSION = 'fleet.incidents';
export const FLEET_INCIDENTS_SETTINGS_PERMISSION = 'fleet.incidents-settings';

/** True when this user's `fleet.incidents` access is unrestricted (admin role, or an explicit oversight grant) rather than limited to owned projects. */
export async function hasIncidentOversight(userId: string, role: string, action: 'view' | 'edit' = 'view'): Promise<boolean> {
  return hasOperationalOversight(userId, role, FLEET_INCIDENTS_PERMISSION, action);
}

/** Same shape for the separate `fleet.incidents-settings` permission (rules/oversight membership). */
export async function hasIncidentSettingsAccess(userId: string, role: string, action: 'view' | 'edit' = 'edit'): Promise<boolean> {
  return hasOperationalOversight(userId, role, FLEET_INCIDENTS_SETTINGS_PERMISSION, action);
}

export interface IncidentScopeFilter {
  /** True for admin/oversight — sees cross-project and projectless incidents. False confines the viewer to projects they manage. */
  unrestricted: boolean;
  pmUserId: string;
  pmStaffId: string | null;
}

/** Resolves the viewer's `fleet.incidents` scope, or null when they lack the base permission entirely. */
export async function resolveIncidentScope(
  userId: string, staffId: string | null, role: string, action: 'view' | 'edit' = 'view',
): Promise<IncidentScopeFilter | null> {
  if (!await userHasPermission(userId, FLEET_INCIDENTS_PERMISSION, action)) return null;
  const unrestricted = await hasIncidentOversight(userId, role, action);
  return { unrestricted, pmUserId: userId, pmStaffId: staffId };
}

interface ProjectRow extends Record<string, unknown> { project_manager: string | null }

/** A restricted scope never sees a projectless incident (design §14: "Incidents with no project require oversight access"). */
export async function isProjectOwnedByScope(scope: IncidentScopeFilter, projectId: string | null): Promise<boolean> {
  if (scope.unrestricted) return true;
  if (!projectId) return false;
  const rows = await query<ProjectRow>(`SELECT project_manager FROM projects WHERE id = $1::uuid LIMIT 1`, [projectId]);
  const project = rows[0];
  if (!project) return false;
  return project.project_manager === scope.pmUserId || (scope.pmStaffId !== null && project.project_manager === scope.pmStaffId);
}

interface ActiveUserRow extends Record<string, unknown> { id: string }

/** Oversight-membership POST must resolve an active FibreFlow user before insert (design §7, this task's brief). */
export async function isActiveFibreFlowUser(userId: string): Promise<boolean> {
  const row = await queryOne<ActiveUserRow>(`SELECT id FROM users WHERE id = $1::uuid AND is_active = true LIMIT 1`, [userId]);
  return row !== null;
}
