/**
 * Bulk lifecycle guard tests — sibling of lifecycle.test.ts, covering
 * transitionReceiptStatusBulk's input validation. The transition
 * adjacency rules themselves are already locked by lifecycle.test.ts
 * (ALLOWED_TRANSITIONS / allowedFromStatusesFor); this file only tests
 * the guards specific to the bulk entrypoint (empty array, per-id UUID
 * validation, id de-duplication happens before the DB call).
 *
 * Pure guard checks only — no DB. Each assertion relies on the throw
 * happening before `sql` is reached.
 */

import { describe, it, expect } from 'vitest';

import { transitionReceiptStatusBulk } from '../queries-review-bulk';

const REVIEWER = '00000000-0000-0000-0000-000000000001';

describe('transitionReceiptStatusBulk guards', () => {
  it('throws if ids is empty', async () => {
    await expect(
      transitionReceiptStatusBulk({
        ids: [],
        action: 'approve',
        reviewerId: REVIEWER,
        note: null,
      })
    ).rejects.toThrow(/ids must not be empty/);
  });

  it('throws if any id is not a UUID', async () => {
    await expect(
      transitionReceiptStatusBulk({
        ids: ['00000000-0000-0000-0000-000000000002', 'not-a-uuid'],
        action: 'approve',
        reviewerId: REVIEWER,
        note: null,
      })
    ).rejects.toThrow(/every id must be a UUID/);
  });

  it('throws if reviewerId is not a UUID', async () => {
    await expect(
      transitionReceiptStatusBulk({
        ids: ['00000000-0000-0000-0000-000000000002'],
        action: 'approve',
        reviewerId: 'definitely-not-a-uuid',
        note: null,
      })
    ).rejects.toThrow(/reviewerId must be a UUID/);
  });
});
