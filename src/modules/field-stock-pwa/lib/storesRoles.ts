/**
 * Shared role-gate constant for all /my/stores routes.
 *
 * Two-layer check:
 *   1. staff.role (StaffRole) — 'stores' or 'admin' staff have direct access.
 *   2. users.role (AuthRole) — 'super_admin' and 'system' callers are admitted
 *      regardless of their staff.role value (they may have no staff row at all,
 *      or may have a staff row with role='technician').
 *
 * isStoresAuthorised() accepts both role and authRole so callers pass
 * `profile.role` and `profile.authRole` directly from the session response
 * without additional null-checks.
 */

import type { StaffRole } from '@/modules/attendance/portal/types';

// =============================================================================
// Constants
// =============================================================================

/**
 * Staff roles (staff.role) permitted to access /my/stores routes.
 * 'super_admin' is excluded because it is not a valid StaffRole value
 * (migration 346 CHECK constraint only allows the six StaffRole values).
 * Super-admin access is handled via the authRole check in isStoresAuthorised().
 */
export const STORES_ROLES = ['stores', 'admin'] as const;

/** Union of the staff role strings in STORES_ROLES. */
export type StoresRole = (typeof STORES_ROLES)[number];

/**
 * AuthRole values (users.role) that unconditionally admit the caller,
 * independent of their staff.role.
 */
export const STORES_AUTH_ROLES = ['super_admin', 'system'] as const;

// =============================================================================
// Helper
// =============================================================================

/**
 * Returns true when the caller is permitted to access /my/stores.
 *
 * Evaluates two checks — either is sufficient:
 *   - staff.role is in STORES_ROLES ('stores' | 'admin')
 *   - users.role (authRole) is in STORES_AUTH_ROLES ('super_admin' | 'system')
 *
 * Both `role` and `authRole` accept null so callers can pass profile fields
 * directly without null-guards.
 */
export function isStoresAuthorised(
  role: StaffRole | null,
  authRole?: string | null,
): boolean {
  // Auth-tier super-user bypass: super_admin and system always get through.
  if (authRole !== undefined && authRole !== null) {
    if ((STORES_AUTH_ROLES as ReadonlyArray<string>).includes(authRole)) {
      return true;
    }
  }
  // Staff-role gate: stores and admin.
  if (role === null) return false;
  return (STORES_ROLES as ReadonlyArray<string>).includes(role);
}

// =============================================================================
// Return-flow helpers (Phase 3)
// =============================================================================

/**
 * Staff roles permitted to create a return via /my/stores/return.
 * Technicians create returns (their own stock); stores/admin can also create
 * one on a tech's behalf.
 */
export const RETURN_CREATOR_ROLES = ['technician', 'stores', 'admin'] as const;

/**
 * Staff roles permitted to inspect+accept a return via /my/stores/inspect/[id].
 * Excludes technician — only stores staff and admins can disposition serials.
 */
export const RETURN_INSPECTOR_ROLES = ['stores', 'admin'] as const;

/** Same authRole bypass as isStoresAuthorised. */
export function isReturnCreator(
  role: StaffRole | null,
  authRole?: string | null,
): boolean {
  if (authRole !== undefined && authRole !== null) {
    if ((STORES_AUTH_ROLES as ReadonlyArray<string>).includes(authRole)) return true;
  }
  if (role === null) return false;
  return (RETURN_CREATOR_ROLES as ReadonlyArray<string>).includes(role);
}

export function isReturnInspector(
  role: StaffRole | null,
  authRole?: string | null,
): boolean {
  if (authRole !== undefined && authRole !== null) {
    if ((STORES_AUTH_ROLES as ReadonlyArray<string>).includes(authRole)) return true;
  }
  if (role === null) return false;
  return (RETURN_INSPECTOR_ROLES as ReadonlyArray<string>).includes(role);
}
