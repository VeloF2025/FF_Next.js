/**
 * Who may approve a parking address change.
 *
 * "Approver" is not a role in this codebase — authorization is page-based
 * (design spec §9.1). It means anyone whose role holds view on
 * fleet.parking-requests, which migration 483 seeds for super_admin, admin
 * and manager, and which migration 485 narrows to two named people.
 *
 * Deliberately its own module, importing nothing but the pool: the real-
 * Postgres test in tests/migrations runs under vitest.migrations.config.ts,
 * whose alias table is minimal by design. Leaving this query inside
 * parkingNotifications.ts would pull notificationBus — and through it
 * @/lib/db-neon and the email/WhatsApp delivery closure — into a suite that
 * only wants to parse one SELECT.
 *
 * ONE query answers both "who do we notify" and "may this person decide", so
 * the two can never drift. That matters more than it looks: withPermission()
 * returns early for role === 'super_admin' (src/lib/auth/middleware.ts) and so
 * does userHasPermission(), which means the RBAC tables migration 485 edits
 * are not consulted at all for the 10 active super_admins. Gating the decision
 * on membership in THIS list instead is what actually narrows approval to the
 * people the migration names — and it makes access and notification the same
 * set by construction, so nobody can decide a request they were never told
 * about.
 *
 * The predicate mirrors userHasPermission (src/lib/permissions/index.ts) —
 * both the per-key CASE and the ancestor cascade — including the non-obvious
 * branches: a `revoke` override whose action is false does NOT block, it falls
 * through to the role; and a key with no override and no role row is blocked,
 * not granted ("No permission entry = blocked"). Approximating either would
 * make this list disagree with the gate on the page.
 */
import { sql } from '@/lib/db-pool';

export const APPROVER_PERMISSION = 'fleet.parking-requests';

/**
 * Shared by both exports below. `onlyUserId` narrows to a single user without
 * a second query — a conditional SQL fragment would fork the predicate, which
 * is the exact drift this module exists to prevent.
 */
async function approverIds(onlyUserId: string | null): Promise<string[]> {
  const rows = await sql<{ id: string }>`
    WITH RECURSIVE ancestors AS (
      SELECT parent_key FROM access_permissions
       WHERE key = ${APPROVER_PERMISSION} AND parent_key IS NOT NULL
      UNION ALL
      SELECT ap.parent_key FROM access_permissions ap
        JOIN ancestors a ON ap.key = a.parent_key
       WHERE ap.parent_key IS NOT NULL
    )
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
      AND (${onlyUserId}::text IS NULL OR u.id::text = ${onlyUserId}::text)
      AND COALESCE(
            CASE
              WHEN ov.override_type = 'grant'
                THEN ov.actions->>'view' = 'true'
              WHEN ov.override_type = 'revoke' AND ov.actions->>'view' = 'true'
                THEN false
              ELSE rp.actions->>'view' = 'true'
            END, false)
      -- Cascade: a blocked ancestor denies the child, so someone who cannot
      -- open /fleet at all is not an approver however the child key reads.
      AND NOT EXISTS (
        SELECT 1
        FROM ancestors anc
        LEFT JOIN LATERAL (
          SELECT o.override_type, o.actions
          FROM user_permission_overrides o
          WHERE o.user_id = u.id
            AND o.permission_key = anc.parent_key
            AND (o.expires_at IS NULL OR o.expires_at > now())
          LIMIT 1
        ) aov ON TRUE
        LEFT JOIN role_permissions arp
          ON arp.role = u.role AND arp.permission_key = anc.parent_key
        WHERE NOT COALESCE(
                CASE
                  WHEN aov.override_type = 'grant'
                    THEN aov.actions->>'view' = 'true'
                  WHEN aov.override_type = 'revoke' AND aov.actions->>'view' = 'true'
                    THEN false
                  ELSE arp.actions->>'view' = 'true'
                END, false)
      )
  `;
  return rows.map((r) => r.id);
}

/** Everyone to notify when a driver declares a new overnight address. */
export async function findApproverUserIds(): Promise<string[]> {
  return approverIds(null);
}

/**
 * May this specific user decide a request? Checked in the decide route on top
 * of withPermission, which cannot answer this for a super_admin because it
 * short-circuits before reading the tables.
 */
export async function isApprover(userId: string): Promise<boolean> {
  const rows = await approverIds(userId);
  return rows.length > 0;
}
