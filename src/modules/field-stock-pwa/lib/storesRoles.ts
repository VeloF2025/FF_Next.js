/**
 * Shared role-gate constant for all /my/stores routes.
 *
 * IMPORTANT — super_admin resolution:
 *   The plan specifies ['stores', 'admin', 'super_admin'] but the current session
 *   shape only exposes staff.role (type StaffRole), which is constrained by the
 *   DB CHECK constraint in migration 346 to the six values in StaffRole. There is
 *   no 'super_admin' in StaffRole, so adding it here is a no-op against the current
 *   session API.
 *
 *   The session (/api/my/session) fetches from staff.role only — it does NOT expose
 *   a separate auth-tier role (e.g. system/super_admin from attendance_auth_sessions).
 *
 *   TODO(Task 3.x): surface an `authRole` field in /api/my/session by reading
 *     attendance_auth_sessions.auth_tier or a separate super-admin flag, then update
 *     the isStoresAuthorised helper to also accept authRole === 'super_admin'.
 *
 *   For now: effective gate is ['stores', 'admin']. 'super_admin' is carried in the
 *   constant so it is ready when authRole is surfaced.
 */

import type { StaffRole } from '@/modules/attendance/portal/types';

// =============================================================================
// Constant
// =============================================================================

/**
 * Staff roles permitted to access /my/stores routes.
 * Note: 'super_admin' is included per the plan but is a no-op until the session
 * API surfaces an authRole field — see module comment above.
 */
export const STORES_ROLES = ['stores', 'admin', 'super_admin'] as const;

/** Union of the role strings in STORES_ROLES. */
export type StoresRole = (typeof STORES_ROLES)[number];

// =============================================================================
// Helper
// =============================================================================

/**
 * Returns true when the staff role is permitted to access /my/stores.
 *
 * Accepts `StaffRole | null` so callers can pass profile.role directly
 * without a null-check. The `super_admin` value in STORES_ROLES cannot
 * currently match because StaffRole does not include it — see module comment.
 */
export function isStoresAuthorised(role: StaffRole | null): boolean {
  if (role === null) return false;
  return (STORES_ROLES as ReadonlyArray<string>).includes(role);
}
