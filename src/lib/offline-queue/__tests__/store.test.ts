import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineQueueStore } from '../store';
import { QueueFullError, QuotaExceededError, type QueuedItem } from '../types';

interface P { note: string }

function item(id: string, attempts = 0, byteSize = 0): QueuedItem<P> {
  return { id, payload: { note: id }, queuedAt: `2026-07-03T00:00:0${id}Z`, attempts, byteSize };
}

/** Install a navigator.storage.estimate stub (or absence) for one test. */
function stubStorageEstimate(value: { usage: number; quota: number } | undefined): void {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: value ? { estimate: vi.fn().mockResolvedValue(value) } : undefined,
  });
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

describe('OfflineQueueStore byte budget', () => {
  let dbN = 0;

  afterEach(() => {
    // Clear any storage-estimate override so it never leaks into another test.
    stubStorageEstimate(undefined);
    vi.restoreAllMocks();
  });

  it('enqueues under the byte budget', async () => {
    const s = new OfflineQueueStore<P>(`ByteDB-${dbN++}`, 50, 1000);
    await s.enqueue(item('1', 0, 400));
    await s.enqueue(item('2', 0, 400)); // running sum 800 ≤ 1000
    expect(await s.countPending()).toBe(2);
  });

  it('throws QuotaExceededError when an enqueue would exceed the byte budget', async () => {
    const s = new OfflineQueueStore<P>(`ByteDB-${dbN++}`, 50, 1000);
    await s.enqueue(item('1', 0, 700));
    await expect(s.enqueue(item('2', 0, 400))).rejects.toBeInstanceOf(QuotaExceededError); // 1100 > 1000
    // The rejected item must NOT have been written.
    expect(await s.countPending()).toBe(1);
  });

  it('treats an at-budget enqueue as allowed and one byte over as rejected', async () => {
    const s = new OfflineQueueStore<P>(`ByteDB-${dbN++}`, 50, 1000);
    await s.enqueue(item('1', 0, 1000)); // exactly at budget → allowed
    await expect(s.enqueue(item('2', 0, 1))).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('persists byteSize on the pending row', async () => {
    const s = new OfflineQueueStore<P>(`ByteDB-${dbN++}`, 50, 10_000);
    await s.enqueue(item('1', 0, 1234));
    const [row] = await s.listPending();
    expect(row.byteSize).toBe(1234);
  });

  it('derives the running byte sum by cursor — no drift after a delete', async () => {
    const s = new OfflineQueueStore<P>(`ByteDB-${dbN++}`, 50, 1000);
    await s.enqueue(item('1', 0, 400));
    await s.enqueue(item('2', 0, 400)); // sum 800
    await expect(s.enqueue(item('3', 0, 400))).rejects.toBeInstanceOf(QuotaExceededError); // 1200 > 1000
    await s.deletePending('1'); // sum back to 400
    await s.enqueue(item('3', 0, 400)); // 800 ≤ 1000 → now allowed
    expect(await s.countPending()).toBe(2);
  });

  it('trips the count cap independently of the byte budget', async () => {
    const s = new OfflineQueueStore<P>(`ByteDB-${dbN++}`, 2, 10_000_000);
    await s.enqueue(item('1', 0, 10));
    await s.enqueue(item('2', 0, 10));
    await expect(s.enqueue(item('3', 0, 10))).rejects.toBeInstanceOf(QueueFullError);
  });

  it('throws when storage.estimate projects usage over the safety fraction', async () => {
    stubStorageEstimate({ usage: 900, quota: 1000 }); // (900+500)/1000 = 1.4 > 0.8
    const s = new OfflineQueueStore<P>(`ByteDB-${dbN++}`, 50, 10_000_000); // byte budget generous
    await expect(s.enqueue(item('1', 0, 500))).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('passes the estimate check when well under the safety fraction', async () => {
    stubStorageEstimate({ usage: 100, quota: 10_000 }); // (100+500)/10000 = 0.06
    const s = new OfflineQueueStore<P>(`ByteDB-${dbN++}`, 50, 10_000_000);
    await s.enqueue(item('1', 0, 500));
    expect(await s.countPending()).toBe(1);
  });

  it('never hard-blocks when storage.estimate is unavailable (byte budget only)', async () => {
    stubStorageEstimate(undefined); // navigator.storage absent
    const s = new OfflineQueueStore<P>(`ByteDB-${dbN++}`, 50, 1000);
    await s.enqueue(item('1', 0, 500)); // under byte budget → allowed despite no estimate
    expect(await s.countPending()).toBe(1);
  });

  it('tags the storage-estimate rejection with kind "device"', async () => {
    stubStorageEstimate({ usage: 900, quota: 1000 }); // over the 0.8 fraction
    const s = new OfflineQueueStore<P>(`ByteDB-${dbN++}`, 50, 10_000_000);
    await expect(s.enqueue(item('1', 0, 500))).rejects.toMatchObject({
      name: 'QuotaExceededError',
      kind: 'device',
    });
  });

  it('tags the queue-budget rejection with kind "queue"', async () => {
    const s = new OfflineQueueStore<P>(`ByteDB-${dbN++}`, 50, 1000);
    await s.enqueue(item('1', 0, 700));
    await expect(s.enqueue(item('2', 0, 400))).rejects.toMatchObject({
      name: 'QuotaExceededError',
      kind: 'queue',
    });
  });

  it('sumPendingBytes reports the derived running total', async () => {
    const s = new OfflineQueueStore<P>(`ByteDB-${dbN++}`, 50, 10_000);
    await s.enqueue(item('1', 0, 300));
    await s.enqueue(item('2', 0, 250));
    expect(await s.sumPendingBytes()).toBe(550);
    await s.deletePending('1');
    expect(await s.sumPendingBytes()).toBe(250);
  });
});
