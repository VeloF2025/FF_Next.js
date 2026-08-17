/**
 * Whether a caller's display name may be used to claim meeting attendance.
 *
 * pages/api/meetings.ts grants access when the caller's email OR their display name
 * appears in a meeting's participant list. Measured before touching it: the name arm is
 * load-bearing, not stray. 13 active users reach meetings through it, and three — a
 * super_admin, an admin and a viewer — reach ZERO by email alone, because Fireflies and
 * Teams participant records frequently carry a display name against a personal or absent
 * address. Deleting the arm would have taken their access away.
 *
 * What the arm must not do, and did:
 *
 *   1. FAIL OPEN on an empty name. `user.name` falls back to '', and 1,649 meetings carry
 *      a participant whose name is the empty string, so a user created without a first or
 *      last name would inherit every one of them. No such user exists today, which is
 *      what makes it latent rather than live.
 *
 *   2. Match a name shared by more than one active user. A display name is not an
 *      identity: two accounts carry "hein van vuuren" — a super_admin and a
 *      technician-role phone login — and the technician one reaches 443 meetings on the
 *      strength of the string alone.
 *
 * Both are decided HERE, once, and the answer is threaded into the route's existing
 * queries as a value. Comparing against SQL NULL is never true, so an unusable name
 * disables the arm without any call site needing to know why — the alternative was
 * repeating the rule at each of the four places the route matches participants, which is
 * how it would drift.
 */

import type { Pool } from 'pg';

export interface ParticipantIdentity {
  /** Lower-cased. Always matched against participant emails. */
  email: string;
  /**
   * The name to match, or NULL when the display name cannot identify this caller.
   * NULL is deliberate: `LOWER(p->>'name') = NULL` is NULL, never true, so the arm
   * simply stops matching rather than needing a separate branch.
   */
  nameForMatch: string | null;
}

/**
 * Resolve what this caller may match on.
 *
 * The uniqueness check runs against `users` at request time rather than being cached:
 * the answer changes when someone is added, renamed or deactivated, and a stale "yes"
 * is the failure this exists to prevent.
 */
export async function resolveParticipantIdentity(
  pool: Pool,
  user: { email?: string | null; name?: string | null },
): Promise<ParticipantIdentity> {
  const email = (user.email ?? '').trim().toLowerCase();
  const name = (user.name ?? '').trim().toLowerCase();

  if (!name) return { email, nameForMatch: null };

  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::int AS n
       FROM users u
      WHERE u.is_active
        AND LOWER(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''))) = $1`,
    [name],
  );

  // Exactly one: a name held by nobody cannot identify the caller either, and a name held
  // by two people identifies neither.
  return { email, nameForMatch: Number(rows[0]?.n ?? 0) === 1 ? name : null };
}
