import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOfflineQueue } from '../useOfflineQueue';
import { OfflineQueueStore } from '../store';
import { QuotaExceededError } from '../types';

// Mutable flag so individual tests can flip online/offline deterministically.
let mockOnline = true;
vi.mock('@/lib/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => mockOnline }));

interface P { note: string }

describe('useOfflineQueue', () => {
  beforeEach(() => {
    mockOnline = true;
    // Fresh DB name per test via a counter so runs don't bleed into each other.
    (globalThis as { __q?: number }).__q = ((globalThis as { __q?: number }).__q ?? 0) + 1;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enqueues then flushes successfully on sync', async () => {
    const submit = vi.fn(async (_p: P) => {});
    const { result } = renderHook(() =>
      useOfflineQueue<P>({ queueName: `Q${(globalThis as { __q?: number }).__q}`, submit })
    );

    await act(async () => { await result.current.enqueue({ note: 'a' }); });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));

    await act(async () => { await result.current.syncNow(); });
    await waitFor(() => expect(result.current.pendingCount).toBe(0));
    expect(submit).toHaveBeenCalledWith({ note: 'a' });
    expect(result.current.dropped).toHaveLength(0);
  });

  it('keeps the item when submit throws a transient error', async () => {
    const submit = vi.fn(async (_p: P) => { throw new Error('network'); });
    const { result } = renderHook(() =>
      useOfflineQueue<P>({ queueName: `Q${(globalThis as { __q?: number }).__q}`, submit })
    );
    await act(async () => { await result.current.enqueue({ note: 'b' }); });
    await act(async () => { await result.current.syncNow(); });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));
  });

  it('keeps syncNow stable across renders for inline-literal callers (no churn loop)', () => {
    const submit = vi.fn(async (_p: P) => {});
    const qn = `Q${(globalThis as { __q?: number }).__q}stable`;
    const { result, rerender } = renderHook(() => useOfflineQueue<P>({ queueName: qn, submit }));
    const first = result.current.syncNow;
    rerender();
    expect(result.current.syncNow).toBe(first);
  });

  it('does not auto-sync while offline', async () => {
    mockOnline = false;
    const submit = vi.fn(async (_p: P) => {});
    const { result } = renderHook(() =>
      useOfflineQueue<P>({ queueName: `Q${(globalThis as { __q?: number }).__q}`, submit })
    );

    await act(async () => { await result.current.enqueue({ note: 'offline' }); });

    expect(result.current.pendingCount).toBe(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it('moves a permanently-failing item to the dropped store on sync', async () => {
    const submit = vi.fn(async (_p: P) => {
      const err = new Error('Conflict') as Error & { status?: number };
      err.status = 409;
      throw err;
    });
    const { result } = renderHook(() =>
      useOfflineQueue<P>({ queueName: `Q${(globalThis as { __q?: number }).__q}`, submit })
    );

    await act(async () => { await result.current.enqueue({ note: 'c' }); });
    await act(async () => { await result.current.syncNow(); });

    await waitFor(() => expect(result.current.pendingCount).toBe(0));
    expect(result.current.dropped).toHaveLength(1);
    expect(result.current.dropped[0].payload).toEqual({ note: 'c' });
  });

  it('threads sizeOf → stores byteSize and allows an under-budget enqueue', async () => {
    const submit = vi.fn(async (_p: P) => {});
    const { result } = renderHook(() =>
      useOfflineQueue<P>({
        queueName: `Q${(globalThis as { __q?: number }).__q}under`,
        submit,
        maxQueueBytes: 10_000,
        sizeOf: () => 500,
      })
    );
    await act(async () => { await result.current.enqueue({ note: 'ok' }); });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));
  });

  it('rejects an enqueue over the byte budget and leaves pendingCount at 0', async () => {
    const submit = vi.fn(async (_p: P) => {});
    const { result } = renderHook(() =>
      useOfflineQueue<P>({
        queueName: `Q${(globalThis as { __q?: number }).__q}over`,
        submit,
        maxQueueBytes: 1000,
        sizeOf: () => 1500, // a single item already exceeds the budget
      })
    );
    let caught: unknown;
    await act(async () => {
      try { await result.current.enqueue({ note: 'big' }); }
      catch (e) { caught = e; }
    });
    expect(caught).toBeInstanceOf(QuotaExceededError);
    expect(result.current.pendingCount).toBe(0);
    expect(submit).not.toHaveBeenCalled();
  });

  it('keeps syncNow stable across renders when a byte budget is configured', () => {
    const submit = vi.fn(async (_p: P) => {});
    const qn = `Q${(globalThis as { __q?: number }).__q}bytestable`;
    const { result, rerender } = renderHook(() =>
      useOfflineQueue<P>({ queueName: qn, submit, maxQueueBytes: 40_000_000, sizeOf: () => 1 })
    );
    const first = result.current.syncNow;
    rerender();
    expect(result.current.syncNow).toBe(first);
  });

  it('flips queueUnavailable to true when the store is unreachable', async () => {
    // Stay offline so the online-transition effect never triggers a second,
    // competing refresh() (via syncNow's finally) that would race the mount
    // effect's refresh() and flip queueUnavailable back to false.
    mockOnline = false;
    const spy = vi
      .spyOn(OfflineQueueStore.prototype, 'countPending')
      .mockRejectedValue(new Error('IDB unreachable'));
    const submit = vi.fn(async (_p: P) => {});
    const { result } = renderHook(() =>
      useOfflineQueue<P>({ queueName: `Q${(globalThis as { __q?: number }).__q}`, submit })
    );

    await waitFor(() => expect(result.current.queueUnavailable).toBe(true));
    spy.mockRestore();
  });
});
