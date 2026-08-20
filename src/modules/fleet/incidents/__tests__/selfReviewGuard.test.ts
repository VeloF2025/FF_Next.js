import { describe, expect, it } from 'vitest';
import { SELF_REVIEW_REFUSAL_MESSAGE, isIncidentSubject } from '../selfReviewGuard';

const STAFF_A = '11111111-1111-4111-8111-111111111111';
const STAFF_B = '22222222-2222-4222-8222-222222222222';

describe('isIncidentSubject', () => {
  it('matches when the actor is the staff member the incident is about', () => {
    expect(isIncidentSubject(STAFF_A, STAFF_A)).toBe(true);
  });

  it('does not match a different staff member', () => {
    expect(isIncidentSubject(STAFF_A, STAFF_B)).toBe(false);
  });

  /**
   * Fails safe in BOTH directions, which is why null can never be treated as a match:
   *
   * - An actor with no staff record cannot be the subject of anything, because incidents
   *   are keyed on `fleet_operational_incidents.staff_id`, which points at a staff row.
   *   Matching null-to-null would lock every manager without a staff record out of the
   *   entire projectless/unassigned queue — a denial-of-service on legitimate review.
   * - Symmetrically, nothing slips past: a real self-review needs two equal, NON-null
   *   staff ids. A null on either side cannot produce that.
   */
  it('never matches when the actor has no staff identity', () => {
    expect(isIncidentSubject(null, STAFF_A)).toBe(false);
    expect(isIncidentSubject(null, null)).toBe(false);
  });

  it('never matches when the incident is about nobody', () => {
    expect(isIncidentSubject(STAFF_A, null)).toBe(false);
  });

  it('states plainly why the action was refused', () => {
    expect(SELF_REVIEW_REFUSAL_MESSAGE).toMatch(/about you/i);
  });
});
