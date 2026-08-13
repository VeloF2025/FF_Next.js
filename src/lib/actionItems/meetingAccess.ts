/**
 * Who may see which action items.
 *
 * Action items are largely MEETING CONTENT — 4,909 of the 5,230 rows are extracted from
 * meeting transcripts and carry the verbatim wording. FibreFlow gates meetings on
 * ATTENDANCE, not on a module permission, so these rows inherit that gate. The
 * `dashboard.action-items` permission decides whether you may open the page at all; this
 * predicate decides WHICH rows the page contains. The permission alone is not a gate here:
 * 84 of 85 active users hold it.
 *
 * Three ways a row is legitimately yours:
 *
 *   1. You attended its meeting.
 *   2. It is assigned to you — by user id or by email. An item assigned to you is yours
 *      even if you missed the meeting where it was raised; that is the normal case for
 *      someone given a task in their absence, and it is what /api/action-items/my-items
 *      already returns. Omitting it would let an item appear in "My Items" and then 404
 *      when clicked.
 *   3. It has no meeting at all. The 321 procurement and hs_audit_overdue rows carry
 *      meeting_id IS NULL — they are operational items, not meeting content, and no
 *      attendance claim can be made about them either way. Gating them on attendance
 *      would hide every procurement action from every user, which is a different bug.
 *
 * Measured against live data, this leaves no user with an empty page: the median user
 * sees 321 rows, the widest 2,084, and nobody sees all 5,230 except the owner.
 *
 * The predicate is built here, once, rather than inlined per query branch. The list route
 * alone had six near-identical branches; six copies of a security filter is six chances to
 * paste the wrong one, and a filter that is merely NEUTRALISED still looks present to a
 * substring-matching test.
 */

import { isOwner } from '@/lib/auth/owner';
import type { AuthUser } from '@/lib/auth/types';

export interface ActionItemAccess {
  /** Owner sees everything. Sourced from the allowlist in lib/auth/owner.ts. */
  isOwner: boolean;
  /** Lower-cased. Empty only when the caller is the owner. */
  email: string;
  /** The caller's user id, matched against action_items.assigned_to_user_id. */
  userId: string;
}

/**
 * Resolve the caller's access, or explain why they have none.
 *
 * A non-owner without an email cannot be scoped — every meeting predicate would be NULL,
 * so the honest answer is a refusal rather than a silently empty list that reads as
 * "you have no action items".
 */
export function resolveActionItemAccess(
  user: AuthUser | undefined,
): { access: ActionItemAccess } | { error: string } {
  const owner = isOwner(user);
  const email = (user?.email ?? '').trim().toLowerCase();
  const userId = (user?.id ?? '').trim();

  if (!owner && !email) {
    return { error: 'An email address is required to scope meeting access.' };
  }
  return { access: { isOwner: owner, email, userId } };
}

/** Append `value` to `params` and return its 1-based placeholder. */
function push(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

/**
 * A boolean SQL expression that is true for rows this caller may see.
 *
 * Returns the literal `TRUE` for the owner — not an empty string. An empty string would
 * have to be concatenated conditionally by every caller, and the caller that forgets is
 * the one that ships an ungated query.
 *
 * `alias` is the action_items alias in the enclosing query. The meeting sub-select uses
 * its own alias (`m_acc`) so it cannot collide with a `meetings` join in that query.
 *
 * NULL handling is deliberate throughout: `LOWER(NULL) = $1` is NULL, not true, so a row
 * with no assignee_email fails closed, and `COALESCE(participants, '[]')` makes a meeting
 * with no participant list unmatchable rather than an error.
 */
export function actionItemVisibility(
  access: ActionItemAccess,
  params: unknown[],
  alias = 'ai',
): string {
  if (access.isOwner) return 'TRUE';

  const email = push(params, access.email);
  const clauses = [
    // Not meeting content — no attendance claim applies.
    `${alias}.meeting_id IS NULL`,
    // Assigned to you by email.
    `LOWER(${alias}.assignee_email) = ${email}`,
    // You attended the meeting it came from.
    `EXISTS (
        SELECT 1 FROM meetings m_acc
        WHERE m_acc.id = ${alias}.meeting_id
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(m_acc.participants, '[]'::jsonb)) AS p_acc
            WHERE LOWER(p_acc->>'email') = ${email}
          )
      )`,
  ];

  // Assigned to you by user id. Only when we have one — an empty string cast to uuid
  // throws, and a caller with no id should simply not match this arm.
  if (access.userId) {
    clauses.push(`${alias}.assigned_to_user_id = ${push(params, access.userId)}::uuid`);
  }

  return `(${clauses.join('\n        OR ')})`;
}
