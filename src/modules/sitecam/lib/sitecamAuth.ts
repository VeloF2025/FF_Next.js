// src/modules/sitecam/lib/sitecamAuth.ts
// Shared role gate for the SiteCam /my pages. Used by both the entry page
// (/my/sitecam) and the wizard deep-link page (/my/sitecam/[siteId]) so the
// authorisation rule lives in exactly one place.

/** Staff roles whose holders capture installation photos via SiteCam. */
export const SITECAM_ROLES: ReadonlyArray<string> = ['technician', 'supervisor'];

/**
 * SiteCam is available to field staff (technician/supervisor) and to the
 * privileged auth roles (super_admin/system) that see every operational tile.
 */
export function isSiteCamAuthorised(
  role: string | null | undefined,
  authRole: string | null | undefined,
): boolean {
  if (authRole === 'super_admin' || authRole === 'system') return true;
  return SITECAM_ROLES.includes(role ?? '');
}
