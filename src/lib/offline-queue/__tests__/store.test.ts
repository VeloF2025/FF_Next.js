import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfflineQueueStore } from '../store';
import { QueueFullError, type QueuedItem } from '../types';

interface P { note: string }

function item(id: string, attempts = 0): QueuedItem<P> {
  return { id, payload: { note: id }, queuedAt: `2026-07-03T00:00:0${id}Z`, attempts };
}

describe('OfflineQueueStore', () => {
  let store: OfflineQueueStore<P>;
  let dbN = 0;

  beforeEach(() => {
    // Unique DB name per test → hermetic isolation. We deliberately avoid
    // deleteDatabase()/__resetForTests here: the store holds a PER-INSTANCE
    // connection (not a module singleton like the attendance original), so a
    // prior test's still-open connection would block deleteDatabase on a
    // shared name. A fresh name per test sidesteps that entirely.
    store = new OfflineQueueStore<P>(`TestQueueDB-${dbN++}`, 3);
  });

  it('enqueues and lists pending in queuedAt order', async () => {
    await store.enqueue(item('2'));
    await store.enqueue(item('1'));
    const pending = await store.listPending();
    expect(pending.map((p) => p.id)).toEqual(['1', '2']);
  });

  it('throws QueueFullError at capacity', async () => {
    await store.enqueue(item('1'));
    await store.enqueue(item('2'));
    await store.enqueue(item('3'));
    await expect(store.enqueue(item('4'))).rejects.toBeInstanceOf(QueueFullError);
  });

  it('bumpAttempts increments and records lastError', async () => {
    await store.enqueue(item('1'));
    await store.bumpAttempts('1', 'boom');
    const [row] = await store.listPending();
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('boom');
  });

  it('drop moves an item from pending to dropped', async () => {
    await store.enqueue(item('1'));
    await store.drop(item('1'), 'permanent');
    expect(await store.countPending()).toBe(0);
    const dropped = await store.listDropped();
    expect(dropped[0].dropReason).toBe('permanent');
  });

  it('acknowledgeDropped clears a dropped row', async () => {
    await store.enqueue(item('1'));
    await store.drop(item('1'), 'permanent');
    await store.acknowledgeDropped('1');
    expect(await store.listDropped()).toHaveLength(0);
  });
});
