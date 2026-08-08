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
 * Overrides ARE folded in, and must be: migration 485 narrowed approval from
 * three roles (30 users) to two named people granted individually. Reading
 * role_permissions alone would return nobody at all, so every violation would
 * notify an empty list while the queue itself worked — a silent failure that
 * looks exactly like "no violations occurred".
 *
 * The CASE below mirrors isPermissionBlocked (src/lib/permissions/index.ts)
 * branch for branch, including the non-obvious one: a `revoke` override whose
 * action is false does NOT block — it falls through to the role. Approximating
 * that would make this list disagree with the gate on the page.
 */
import { sql } from '@/lib/db-pool';

export const APPROVER_PERMISSION = 'fleet.parking-requests';

export async function findApproverUserIds(): Promise<string[]> {
  const rows = await sql<{ id: string }>`
    SELECT u.id
    FROM users u
    LEFT JOIN LATERAL (
      SELECT o.override_type, o.actions
      FROM user_permission_overrides o
      WHERE o.user_id = u.id
        AND o.permission_key = ${APPROVER_PERMISSION}
        AND (o.expires_at IS NULL OR o.expires_at > now())
      LIMIT 1
    ) ov ON TRUE
    LEFT JOIN role_permissions rp
      ON rp.role = u.role AND rp.permission_key = ${APPROVER_PERMISSION}
    WHERE u.is_active = true
      AND CASE
            WHEN ov.override_type = 'grant'
              THEN ov.actions->>'view' = 'true'
            WHEN ov.override_type = 'revoke' AND ov.actions->>'view' = 'true'
              THEN false
            ELSE rp.actions->>'view' = 'true'
          END
  `;
  return rows.map((r) => r.id);
}

