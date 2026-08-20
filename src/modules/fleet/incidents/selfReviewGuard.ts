/**
 * One rule, shared by every state-changing Fleet incident path: a manager may not act on
 * an incident that is about them.
 *
 * The scope chain (`reviewScope.isProjectOwnedByScope`) only ever asked "is this incident
 * in a project you manage?" — never "is this incident about you?". Because
 * `isProjectOwnedByScope` matches `projects.project_manager` against either the viewer's
 * `users.id` OR their `staff.id`, a supervisor who manages a project, holds
 * `fleet.incidents` view+edit, and is on the operational roster could acknowledge, start
 * review on, and dismiss an incident raised about their own conduct — three calls, all 200.
 *
 * The decided behaviour is a flat refusal: the action is rejected, the incident stays open,
 * and it remains visible to the rest of oversight (unrestricted scope), who can action it.
 * Nothing is auto-routed, auto-reassigned, or notified. The guard applies regardless of
 * scope — an oversight member is no more entitled to close their own incident than a PM is;
 * every OTHER oversight member is unaffected.
 *
 * Comparison is on the same identity axis the incident itself uses: `staff_id`. Never on
 * `users.id` — the incident does not carry one, and `project_manager` mixes both axes.
 */

/**
 * True when `actorStaffId` is the staff member `incidentStaffId` refers to.
 *
 * A null on either side is never a match, and that direction is deliberate:
 *
 * - An actor with no staff record cannot BE the subject of any incident (incidents are
 *   keyed on a `staff.id`), so refusing them would be a pure false positive that locks
 *   legitimate reviewers out of the whole unassigned queue.
 * - Nothing can slip past in the other direction either, because a genuine self-review
 *   requires two equal, non-null staff ids — a null cannot manufacture one.
 */
export function isIncidentSubject(actorStaffId: string | null, incidentStaffId: string | null): boolean {
  if (actorStaffId === null || incidentStaffId === null) return false;
  return actorStaffId === incidentStaffId;
}

export const SELF_REVIEW_REFUSAL_MESSAGE =
  'You cannot act on a Fleet incident that is about you — another oversight member must review it';
