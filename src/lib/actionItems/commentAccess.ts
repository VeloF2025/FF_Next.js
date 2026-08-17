/**
 * Who may read which manco action-item comments.
 *
 * A comment is one of two things and they have different rules:
 *
 *   - Written by a person (`source_meeting_id IS NULL`). Visible to anyone who can see
 *     the item. Gating these on meeting attendance would break ordinary collaboration —
 *     most manco items are discussed by people who were not in the meeting that raised
 *     them, and many have no meeting at all.
 *   - Extracted verbatim from a meeting transcript (`source_meeting_id` set). This is
 *     meeting content wearing a comment's clothes, and it carries the meeting's own
 *     attendance gate.
 *
 * The distinction has to be structural. Before migration 493 the only marker was a
 * `[From meeting: <title>]` prefix inside the free-text body — forgeable by anyone who
 * can post a comment, and dependent on a title that can change.
 *
 * This is the sink half of the extractor gate. Gating the pull without gating the read
 * moves the leak rather than closing it: the excerpts outlive the request that created
 * them, and every authenticated user was reading them here.
 */

import { meetingAttendance, type ActionItemAccess } from './meetingAccess';

/**
 * A boolean SQL expression true for comments this caller may read.
 *
 * `alias` is the manco_action_item_comments alias in the enclosing query. The meeting
 * sub-select uses `m_cmt` so it cannot collide with a `meetings` join in that query.
 *
 * Returns the literal `TRUE` for the owner rather than an empty string, for the same
 * reason the meeting predicate does: an empty string would have to be concatenated
 * conditionally by every caller, and the caller that forgets ships an ungated query.
 */
export function commentVisibility(
  access: ActionItemAccess,
  params: unknown[],
  alias = 'c',
): string {
  if (access.isOwner) return 'TRUE';

  // meetingAttendance pushes onto the array it is given and numbers its placeholders
  // from that array's length, so passing the caller's array is all the bookkeeping
  // needed. An earlier version built a private array and regex-renumbered the result;
  // that is a silent-corruption bug waiting for the first query with two predicates.
  const attended = meetingAttendance(access, params, 'm_cmt');

  return `(
      ${alias}.source_meeting_id IS NULL
      OR EXISTS (
        SELECT 1 FROM meetings m_cmt
        WHERE m_cmt.id = ${alias}.source_meeting_id
          AND ${attended}
      )
    )`;
}
