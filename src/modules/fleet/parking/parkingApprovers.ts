/**
 * Who may approve a parking address change.
 *
 * "Approver" is not a role in this codebase — authorization is page-based
 * (design spec §9.1). It means anyone whose role holds view on
 * fleet.parking-requests, which migration 483 seeds for super_admin, admin
 * and manager.
 *
 * Deliberately its own module, importing nothing but the pool: the real-
 * Postgres test in tests/migrations runs under vitest.migrations.config.ts,
 * whose alias table is minimal by design. Leaving this query inside
 * parkingNotifications.ts would pull notificationBus — and through it
 * @/lib/db-neon and the email/WhatsApp delivery closure — into a suite that
 * only wants to parse one SELECT.
 *
 * Known limitation, recorded rather than hidden: this reads role_permissions
 * only. A user granted the page through user_permission_overrides is not
 * returned, and one revoked through an override still is. Folding overrides in
 * means per-user evaluation (src/lib/permissions/index.ts works one user at a
 * time) for a set that is currently three roles wide. PR 3's approval queue
 * needs the same list — that is the point to revisit it.
 */
import { sql } from '@/lib/db-pool';

export const APPROVER_PERMISSION = 'fleet.parking-requests';

export async function findApproverUserIds(): Promise<string[]> {
  const rows = await sql<{ id: string }>`
    SELECT u.id
    FROM users u
    JOIN role_permissions rp ON rp.role = u.role
    WHERE u.is_active = true
      AND rp.permission_key = ${APPROVER_PERMISSION}
      AND rp.actions->>'view' = 'true'
  `;
  return rows.map((r) => r.id);
}
