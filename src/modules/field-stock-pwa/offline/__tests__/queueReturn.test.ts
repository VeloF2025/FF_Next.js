/**
 * Unit tests for the IndexedDB-backed offline return queue (queueReturn.ts).
 *
 * Environment: jsdom (configured globally in vitest.config.ts).
 * jsdom 22 does not ship with an IndexedDB implementation. We polyfill
 * globally using `fake-indexeddb` (dev dependency) before any imports
 * touch the queue module. __resetDbForTests() wipes the singleton between
 * each test so isolation is guaranteed.
 *
 * Coverage:
 *  - enqueueReturn:       returns UUID, persists row
 *  - listQueuedReturns:   returns items oldest-first
 *  - dropQueuedReturn:    removes by id; idempotent on missing id
 *  - bumpReturnAttempt:   increments attempts, sets lastError
 *  - abandonReturn:       moves item from pending-returns to abandoned-returns
 *  - listAbandonedReturns: returns newest-abandonedAt first
 *  - clearAbandonedReturn: removes from abandoned store; idempotent
 *  - Cross-store isolation: return ops do NOT touch issue stores
 */

// 🟢 WORKING: mirrors queueIssue.test.ts — fake-indexeddb polyfill + __resetDbForTests

// Polyfill IndexedDB for jsdom (jsdom 22 does not include IDB).
// fake-indexeddb/auto assigns window.indexedDB et al. on import.
import 'fake-indexeddb/auto';

import { describe, it, expect, beforeEach } from 'vitest';

import {
  enqueueReturn,
  listQueuedReturns,
  dropQueuedReturn,
  bumpReturnAttempt,
  abandonReturn,
  listAbandonedReturns,
  clearAbandonedReturn,
} from '../queueReturn';
import { __resetDbForTests } from '../db';
import type { PwaReturnDraft } from '../../types';
import type { PwaMyHeldSerial } from '../../types';

// =============================================================================
// Helpers
// =============================================================================

/** Minimal valid PwaMyHeldSerial for queue tests. */
function heldSerial(overrides: Partial<PwaMyHeldSerial> = {}): PwaMyHeldSerial {
  return {
    serialId: 'serial-uuid-001',
    serialNumber: 'SN-TEST-001',
    stockItemId: 'item-uuid-001',
    stockItemName: 'ONT XS-010X',
    sourceLocationId: 'loc-warehouse-uuid',
    sourceLocationName: 'Main Warehouse',
    ...overrides,
  };
}

/** Minimal valid PwaReturnDraft for queue tests. */
function draft(overrides: Partial<PwaReturnDraft> = {}): PwaReturnDraft {
  return {
    reason: 'unused',
    reasonNotes: null,
    serials: [heldSerial()],
    signatureDataUrl: null,
    returnToLocationId: 'loc-warehouse-uuid',
    originalPickingId: null,
    notes: '',
    ...overrides,
  };
}

// =============================================================================
// Setup
// =============================================================================

beforeEach(async () => {
  await __resetDbForTests();
});

// =============================================================================
// enqueueReturn
// =============================================================================

describe('enqueueReturn', () => {
  it('returns a UUID string', async () => {
    const id = await enqueueReturn(draft());
    // UUID v4 pattern: 8-4-4-4-12 hex groups
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('persists the row so listQueuedReturns returns it', async () => {
    const d = draft();
    const id = await enqueueReturn(d);
    const items = await listQueuedReturns();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(id);
    expect(items[0].draft).toEqual(d);
    expect(items[0].attempts).toBe(0);
    expect(items[0].lastError).toBeUndefined();
  });

  it('records enqueuedAt as a recent epoch-ms timestamp', async () => {
    const before = Date.now();
    await enqueueReturn(draft());
    const after = Date.now();
    const items = await listQueuedReturns();
    expect(items[0].enqueuedAt).toBeGreaterThanOrEqual(before);
    expect(items[0].enqueuedAt).toBeLessThanOrEqual(after);
  });

  it('generates a distinct UUID on each call', async () => {
    const id1 = await enqueueReturn(draft());
    const id2 = await enqueueReturn(draft());
    expect(id1).not.toBe(id2);
  });
});

// =============================================================================
// listQueuedReturns
// =============================================================================

describe('listQueuedReturns', () => {
  it('returns an empty array when the queue is empty', async () => {
    const items = await listQueuedReturns();
    expect(items).toEqual([]);
  });

  it('returns all queued items sorted oldest-first by enqueuedAt', async () => {
    const id1 = await enqueueReturn(draft({ notes: 'first' }));
    const id2 = await enqueueReturn(draft({ notes: 'second' }));
    const id3 = await enqueueReturn(draft({ notes: 'third' }));

    const items = await listQueuedReturns();
    expect(items).toHaveLength(3);

    // listQueuedReturns must return them in non-decreasing enqueuedAt order.
    for (let i = 1; i < items.length; i++) {
      expect(items[i].enqueuedAt).toBeGreaterThanOrEqual(items[i - 1].enqueuedAt);
    }

    // All three IDs are present regardless of order when timestamps collide.
    const ids = items.map((x) => x.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
    expect(ids).toContain(id3);
  });
});

// =============================================================================
// dropQueuedReturn
// =============================================================================

describe('dropQueuedReturn', () => {
  it('removes the item so listQueuedReturns no longer returns it', async () => {
    const id = await enqueueReturn(draft());
    await dropQueuedReturn(id);
    const items = await listQueuedReturns();
    expect(items).toHaveLength(0);
  });

  it('is idempotent when called with a missing id', async () => {
    await expect(dropQueuedReturn('non-existent-uuid')).resolves.toBeUndefined();
  });

  it('removes only the targeted item when multiple are queued', async () => {
    const id1 = await enqueueReturn(draft({ notes: 'keep' }));
    const id2 = await enqueueReturn(draft({ notes: 'remove' }));
    await dropQueuedReturn(id2);
    const items = await listQueuedReturns();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(id1);
  });
});

// =============================================================================
// bumpReturnAttempt
// =============================================================================

describe('bumpReturnAttempt', () => {
  it('increments attempts by 1 and sets lastError', async () => {
    const id = await enqueueReturn(draft());
    await bumpReturnAttempt(id, 'Server 500');

    const items = await listQueuedReturns();
    expect(items[0].attempts).toBe(1);
    expect(items[0].lastError).toBe('Server 500');
  });

  it('accumulates multiple bumps correctly', async () => {
    const id = await enqueueReturn(draft());
    await bumpReturnAttempt(id, 'attempt 1');
    await bumpReturnAttempt(id, 'attempt 2');
    await bumpReturnAttempt(id, 'attempt 3');

    const items = await listQueuedReturns();
    expect(items[0].attempts).toBe(3);
    expect(items[0].lastError).toBe('attempt 3');
  });

  it('is a no-op for a missing id (does not throw)', async () => {
    await expect(bumpReturnAttempt('ghost-id', 'error')).resolves.toBeUndefined();
  });

  it('preserves all other fields unchanged after a bump', async () => {
    const d = draft({ notes: 'keep-me' });
    const id = await enqueueReturn(d);
    await bumpReturnAttempt(id, 'transient');

    const items = await listQueuedReturns();
    expect(items[0].draft).toEqual(d);
    expect(items[0].id).toBe(id);
  });
});

// =============================================================================
// abandonReturn
// =============================================================================

describe('abandonReturn', () => {
  it('happy path: moves item from pending-returns to abandoned-returns', async () => {
    const id = await enqueueReturn(draft());
    const pending = await listQueuedReturns();
    expect(pending).toHaveLength(1);

    const queued = pending[0];
    const beforeAbandon = Date.now();
    await abandonReturn(queued);
    const afterAbandon = Date.now();

    // pending-returns store must be empty after move.
    const remaining = await listQueuedReturns();
    expect(remaining).toHaveLength(0);

    // abandoned-returns store must have the item with required shape.
    const abandoned = await listAbandonedReturns();
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0].id).toBe(id);
    expect(abandoned[0].draft).toEqual(queued.draft);
    expect(abandoned[0].enqueuedAt).toBe(queued.enqueuedAt);
    expect(abandoned[0].abandonedAt).toBeGreaterThanOrEqual(beforeAbandon);
    expect(abandoned[0].abandonedAt).toBeLessThanOrEqual(afterAbandon);
    // lastError defaults to 'Unknown error' when undefined on the queued item.
    expect(abandoned[0].lastError).toBe('Unknown error');
  });

  it('honours lastError from the queued item', async () => {
    const id = await enqueueReturn(draft());
    await bumpReturnAttempt(id, '400 Invalid returnToLocationId');
    const pending = await listQueuedReturns();
    await abandonReturn(pending[0]);

    const abandoned = await listAbandonedReturns();
    expect(abandoned[0].lastError).toBe('400 Invalid returnToLocationId');
    expect(abandoned[0].attempts).toBe(1);
  });

  it('is a noop on the abandoned store when the queued item does not exist in pending', async () => {
    // Construct a synthetic QueuedReturn that was never written to IDB.
    // abandonReturn writes to abandoned FIRST, then deletes from pending.
    // Deleting a non-existent key from IDB is a safe noop, so this must not throw.
    // The abandoned store should still receive the item (write-first semantics).
    const syntheticItem = {
      id: 'ghost-return-abc123',
      draft: draft(),
      enqueuedAt: Date.now() - 10_000,
      attempts: 3,
      lastError: 'Synthetic error for idempotency test',
    };

    await expect(abandonReturn(syntheticItem)).resolves.toBeUndefined();

    // The abandoned store should contain the item despite it never being in pending.
    const abandoned = await listAbandonedReturns();
    expect(abandoned.some((a) => a.id === 'ghost-return-abc123')).toBe(true);
  });
});

// =============================================================================
// listAbandonedReturns — ordering
// =============================================================================

describe('listAbandonedReturns', () => {
  it('returns items newest-abandonedAt first (descending order)', async () => {
    const id1 = await enqueueReturn(draft({ notes: 'first' }));
    const id2 = await enqueueReturn(draft({ notes: 'second' }));
    const id3 = await enqueueReturn(draft({ notes: 'third' }));

    const all = await listQueuedReturns();
    const byId = Object.fromEntries(all.map((q) => [q.id, q]));

    // Abandon in insertion order to generate naturally ascending abandonedAt values.
    await abandonReturn(byId[id1]);
    await abandonReturn(byId[id2]);
    await abandonReturn(byId[id3]);

    const abandoned = await listAbandonedReturns();
    expect(abandoned).toHaveLength(3);

    // listAbandonedReturns sorts newest-first: each item's abandonedAt >= next item's.
    for (let i = 0; i + 1 < abandoned.length; i++) {
      expect(abandoned[i].abandonedAt).toBeGreaterThanOrEqual(abandoned[i + 1].abandonedAt);
    }

    // All three IDs are present.
    const ids = abandoned.map((a) => a.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
    expect(ids).toContain(id3);
  });

  it('returns an empty array when no items are abandoned', async () => {
    const result = await listAbandonedReturns();
    expect(result).toEqual([]);
  });
});

// =============================================================================
// clearAbandonedReturn
// =============================================================================

describe('clearAbandonedReturn', () => {
  it('removes a single abandoned item by id', async () => {
    const id1 = await enqueueReturn(draft({ notes: 'keep' }));
    const id2 = await enqueueReturn(draft({ notes: 'remove' }));
    const all = await listQueuedReturns();
    const byId = Object.fromEntries(all.map((q) => [q.id, q]));

    await abandonReturn(byId[id1]);
    await abandonReturn(byId[id2]);

    await clearAbandonedReturn(id2);

    const abandoned = await listAbandonedReturns();
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0].id).toBe(id1);
  });

  it('is idempotent when called with a non-existent id', async () => {
    await expect(clearAbandonedReturn('never-abandoned-uuid')).resolves.toBeUndefined();
    const abandoned = await listAbandonedReturns();
    expect(abandoned).toHaveLength(0);
  });
});

// =============================================================================
// Cross-store isolation
// =============================================================================

describe('cross-store isolation', () => {
  it('enqueueing a return does NOT add anything to the pending-issues store', async () => {
    // Import queueIssue's listQueued to directly probe the pending-issues store.
    const { listQueued } = await import('../queueIssue');

    await enqueueReturn(draft());

    const issues = await listQueued();
    expect(issues).toHaveLength(0);
  });

  it('clearing an abandoned return does NOT affect the abandoned-issues store', async () => {
    // Import queueIssue's abandonIssue + listAbandoned to probe the abandoned-issues store.
    const { enqueueIssue, listQueued, abandonIssue, listAbandoned } = await import('../queueIssue');

    // Put one item in abandoned-issues.
    const issueDraft = {
      technicianId: 'tech-uuid-001',
      contractorId: null,
      stockItemId: 'item-uuid-001',
      serials: [],
      signatureDataUrl: null,
      notes: 'isolation test',
      sourceLocationId: 'loc-warehouse-uuid',
      destinationLocationId: 'loc-field-default-uuid',
    };
    const issueId = await enqueueIssue(issueDraft);
    const pendingIssues = await listQueued();
    await abandonIssue(pendingIssues[0]);

    // Now abandon a return and then clear it.
    const returnId = await enqueueReturn(draft());
    const pendingReturns = await listQueuedReturns();
    await abandonReturn(pendingReturns[0]);
    await clearAbandonedReturn(returnId);

    // The abandoned-issues store must still have its item.
    const abandonedIssues = await listAbandoned();
    expect(abandonedIssues).toHaveLength(1);
    expect(abandonedIssues[0].id).toBe(issueId);
  });
});
