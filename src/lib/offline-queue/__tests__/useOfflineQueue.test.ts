import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOfflineQueue } from '../useOfflineQueue';

// Force the "online" branch deterministically.
vi.mock('@/lib/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

interface P { note: string }

describe('useOfflineQueue', () => {
  beforeEach(() => {
    // Fresh DB name per test via a counter so runs don't bleed into each other.
    (globalThis as { __q?: number }).__q = ((globalThis as { __q?: number }).__q ?? 0) + 1;
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
});
