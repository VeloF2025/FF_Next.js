// src/modules/sitecam/lib/sitecamAuth.ts
// Shared role gate for the SiteCam /my pages. Used by both the entry page
// (/my/sitecam) and the wizard deep-link page (/my/sitecam/[siteId]) so the
// authorisation rule lives in exactly one place.

/** Staff roles whose holders capture installation photos via SiteCam. */
export const SITECAM_ROLES: ReadonlyArray<string> = ['technician', 'supervisor'];

/**
 * SiteCam is open to every authenticated portal user — including pending,
 * self-registered field technicians, who must be able to capture installation
 * photos in the field from their first sign-in, before an admin activates them.
 *
 * To restore the original field-staff gate (technician/supervisor + the
 * privileged super_admin/system auth roles), replace the body with:
 *
 *   if (authRole === 'super_admin' || authRole === 'system') return true;
 *   return SITECAM_ROLES.includes(role ?? '');
 *
 * and rename the params back to `role` / `authRole`.
 */
export function isSiteCamAuthorised(
  _role: string | null | undefined,
  _authRole: string | null | undefined,
  _accountStatus?: string | null,
): boolean {
  return true;
}
