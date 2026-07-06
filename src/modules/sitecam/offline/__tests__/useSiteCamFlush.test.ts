import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSiteCamFlush } from '../useSiteCamFlush';

vi.mock('@/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Mutable flag so individual tests can flip online/offline deterministically —
// mirrors src/lib/offline-queue/__tests__/useOfflineQueue.test.ts.
let mockOnline = true;
vi.mock('@/lib/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => mockOnline }));

beforeEach(() => {
  mockOnline = true;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('useSiteCamFlush', () => {
  // NOTE: mount-time flushes are awaited via `advanceTimersByTimeAsync(0)`, NOT
  // `runOnlyPendingTimersAsync()` — the latter fires every timer currently in
  // the queue regardless of its delay, which would ALSO trigger the 60s poll
  // interval's first tick on every mount assertion (a fake-timer footgun, not
  // a hook bug — confirmed by tracing the extra call to the interval callback).

  it('auto-attempts a flush on mount when online and queued', async () => {
    const attemptFlush = vi.fn(async () => {});
    renderHook(() => useSiteCamFlush(true, false, attemptFlush));

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(attemptFlush).toHaveBeenCalledTimes(1);
  });

  it('does not attempt a flush when nothing is queued', async () => {
    const attemptFlush = vi.fn(async () => {});
    renderHook(() => useSiteCamFlush(false, false, attemptFlush));

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(attemptFlush).not.toHaveBeenCalled();
  });

  it('does not auto-attempt while offline', async () => {
    mockOnline = false;
    const attemptFlush = vi.fn(async () => {});
    renderHook(() => useSiteCamFlush(true, false, attemptFlush));

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(attemptFlush).not.toHaveBeenCalled();
  });

  it('does not auto-attempt while a definitive error is showing (mirrors the dropped-store contract)', async () => {
    const attemptFlush = vi.fn(async () => {});
    renderHook(() => useSiteCamFlush(true, true, attemptFlush));

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(attemptFlush).not.toHaveBeenCalled();
  });

  it('manual syncNow always attempts, even with a definitive error showing', async () => {
    const attemptFlush = vi.fn(async () => {});
    const { result } = renderHook(() => useSiteCamFlush(true, true, attemptFlush));
    // Clear the mount-time call count expectation — mount itself must not fire.
    expect(attemptFlush).not.toHaveBeenCalled();

    await act(async () => { await result.current.syncNow(); });

    expect(attemptFlush).toHaveBeenCalledTimes(1);
  });

  it('polls every 60s while online and queued', async () => {
    const attemptFlush = vi.fn(async () => {});
    renderHook(() => useSiteCamFlush(true, false, attemptFlush));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); }); // mount-time call
    expect(attemptFlush).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(attemptFlush).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when syncNow is called again while already in flight', async () => {
    let resolveFirst: (() => void) | undefined;
    const attemptFlush = vi.fn(
      () => new Promise<void>((resolve) => { resolveFirst = resolve; }),
    );
    const { result } = renderHook(() => useSiteCamFlush(true, false, attemptFlush));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(attemptFlush).toHaveBeenCalledTimes(1);

    // A second manual call while the first is still in flight must not re-enter.
    act(() => { void result.current.syncNow(); });
    expect(attemptFlush).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await act(async () => { await Promise.resolve(); });
  });

  it('exposes the current online status', () => {
    mockOnline = false;
    const { result } = renderHook(() => useSiteCamFlush(false, false, vi.fn()));
    expect(result.current.online).toBe(false);
  });
});
