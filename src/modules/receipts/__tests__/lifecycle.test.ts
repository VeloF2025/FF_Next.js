/**
 * Receipt lifecycle / state-machine tests.
 *
 * Locks the ALLOWED_TRANSITIONS adjacency map and the
 * `allowedFromStatusesFor()` inverse derivation. The SQL `WHERE` in
 * transitionReceiptStatus is `status = ANY(allowedFrom)` — so if this
 * test passes for a target status, the SQL allows exactly that
 * pre-image set.
 *
 * Pure functions only — no DB. The transitionReceiptStatus DB write
 * itself isn't unit-testable without a real Postgres; what IS unit-
 * testable is its UUID guard, which we assert here too.
 */

import { describe, it, expect } from 'vitest';

import {
  ACTION_TO_STATUS,
  ALLOWED_TRANSITIONS,
  allowedFromStatusesFor,
  transitionReceiptStatus,
  type ReviewAction,
} from '../queries-review';
import type { ReceiptStatus } from '../queries';

const ALL_STATUSES: ReceiptStatus[] = ['submitted', 'approved', 'rejected', 'reconciled'];
const ALL_ACTIONS: ReviewAction[] = ['approve', 'reject', 'reconcile'];

describe('ALLOWED_TRANSITIONS', () => {
  it('covers every receipt status as a key', () => {
    for (const s of ALL_STATUSES) {
      expect(ALLOWED_TRANSITIONS).toHaveProperty(s);
    }
  });

  it('never lets a status transition to itself', () => {
    for (const from of ALL_STATUSES) {
      expect(ALLOWED_TRANSITIONS[from]).not.toContain(from);
    }
  });

  it('only ever lists known target statuses', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALLOWED_TRANSITIONS[from]) {
        expect(ALL_STATUSES).toContain(to);
      }
    }
  });

  it('encodes the documented adjacency exactly', () => {
    // Snapshot the rules so any change MUST update the test, never
    // silently drift in the SQL.
    expect(ALLOWED_TRANSITIONS).toEqual({
      submitted: ['approved', 'rejected'],
      approved: ['reconciled', 'rejected'],
      rejected: ['approved'],
      reconciled: ['approved'],
    });
  });
});

describe('ACTION_TO_STATUS', () => {
  it('has an entry for every review action', () => {
    for (const action of ALL_ACTIONS) {
      expect(ACTION_TO_STATUS).toHaveProperty(action);
    }
  });

  it('every action target is a known status', () => {
    for (const action of ALL_ACTIONS) {
      expect(ALL_STATUSES).toContain(ACTION_TO_STATUS[action]);
    }
  });
});

describe('allowedFromStatusesFor', () => {
  it('approved can be reached from submitted, rejected, and reconciled (but not approved itself)', () => {
    expect(allowedFromStatusesFor('approved').sort()).toEqual(
      ['rejected', 'reconciled', 'submitted'].sort()
    );
  });

  it('rejected can be reached from submitted and approved only', () => {
    expect(allowedFromStatusesFor('rejected').sort()).toEqual(['approved', 'submitted'].sort());
  });

  it('reconciled can only be reached from approved', () => {
    expect(allowedFromStatusesFor('reconciled')).toEqual(['approved']);
  });

  it('submitted is a one-way door — nothing transitions back to it', () => {
    // Important business rule: once HR/finance have acted, the
    // receipt cannot revert to "submitted" (no edit-after-review).
    expect(allowedFromStatusesFor('submitted')).toEqual([]);
  });

  // Note: an earlier "matches the inverse of ALLOWED_TRANSITIONS"
  // test was removed because it was tautological — it re-implemented
  // the function under test using the same algorithm, so a
  // consistently-wrong allowedFromStatusesFor would still pass it.
  // The four explicit per-status tests above are the real coverage.
});

describe('transitionReceiptStatus UUID guards', () => {
  // We never reach the DB — the assertion lives at the top of the
  // function, before sql is called. Any throw confirms the guard
  // fires before the SQL would have run.

  it('throws if id is not a UUID', async () => {
    await expect(
      transitionReceiptStatus({
        id: 'not-a-uuid',
        action: 'approve',
        reviewerId: '00000000-0000-0000-0000-000000000001',
        note: null,
      })
    ).rejects.toThrow(/id must be a UUID/);
  });

  it('throws if reviewerId is not a UUID', async () => {
    await expect(
      transitionReceiptStatus({
        id: '00000000-0000-0000-0000-000000000002',
        action: 'approve',
        reviewerId: 'definitely-not-a-uuid',
        note: null,
      })
    ).rejects.toThrow(/reviewerId must be a UUID/);
  });

  it('throws if id is empty string', async () => {
    await expect(
      transitionReceiptStatus({
        id: '',
        action: 'reject',
        reviewerId: '00000000-0000-0000-0000-000000000001',
        note: 'reason',
      })
    ).rejects.toThrow(/id must be a UUID/);
  });
});
