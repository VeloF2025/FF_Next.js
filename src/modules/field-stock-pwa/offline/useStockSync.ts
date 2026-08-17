/**
 * Hook that owns the offline-queue lifecycle for /my/stores issue AND return
 * submissions.
 *
 * Mirrors `useAttendanceSync` (src/modules/attendance/portal/client/offline/)
 * verbatim except for:
 *  - IDB operations delegated to `queueIssue` / `queueReturn` (not `db.ts`)
 *  - Network calls delegate to `submitIssue` / `submitReturn` from `../api`
 *  - Audit-store pattern for permanently-failed items: stock pickings/returns are
 *    signed attestation artefacts, so a 4xx that exceeds MAX_ATTEMPTS is moved to
 *    the 'abandoned-issues' / 'abandoned-returns' store rather than silently deleted.
 *    The stores person sees them in the AbandonedIssuesBanner and can re-issue or
 *    dismiss manually.
 *
 * Drain triggers (same as attendance):
 *  1. Browser fires `online` event.
 *  2. Component mounts while already online.
 *  3. Caller invokes `drain()` directly (e.g. after a fresh enqueue).
 *  4. Periodic 60-second poll while online + pendingCount > 0 (covers the
 *     case where the browser never fires an `online` edge after a brief
 *     3G blip that caused a NETWORK_ERROR enqueue).
 *
 * Error classification (4xx vs 5xx):
 *  - 2xx → `dropQueued(id)` / `dropQueuedReturn(id)`.
 *  - Network error / 5xx / 408 / 429 → transient; `bumpAttempt` / `bumpReturnAttempt`
 *    and leave.
 *  - 4xx (permanent) → bump; if attempts >= MAX_ATTEMPTS, abandon. MAX_ATTEMPTS = 5.
 *
 * API stability: existing callers reading `pendingCount` and `abandonedCount` continue
 * to work — those values are now totals (issues + returns). New callers can access
 * the per-queue breakdowns via `pendingIssuesCount`, `pendingReturnsCount`,
 * `abandonedIssuesCount`, `abandonedReturnsCount`.
 */

// 🟢 WORKING: mirrors useAttendanceSync shape

import { useCallback, useEffect, useRef, useState } from 'react';

import { log } from '@/lib/logger';
import { submitIssue, submitReturn, ApiError } from '../api';
import {
  abandonIssue,
  bumpAttempt,
  clearAbandoned,
  dropQueued,
  listAbandoned,
  listQueued,
} from './queueIssue';
import {
  abandonReturn,
  bumpReturnAttempt,
  clearAbandonedReturn,
  dropQueuedReturn,
  listAbandonedReturns,
  listQueuedReturns,
} from './queueReturn';
import { useOnlineStatus } from '@/lib/hooks/useOnlineStatus';

/** After this many failed 4xx attempts the queued item is permanently dropped.
 *  5xx / network errors do NOT count toward this cap — they are transient. */
const MAX_ATTEMPTS = 5;

const POLL_INTERVAL_MS = 60_000;

export interface UseStockSyncResult {
  /** Total of pending-issues + pending-returns. */
  pendingCount: number;
  pendingIssuesCount: number;
  pendingReturnsCount: number;
  /** Total of abandoned-issues + abandoned-returns. */
  abandonedCount: number;
  abandonedIssuesCount: number;
  abandonedReturnsCount: number;
  syncing: boolean;
  /** Force a sync cycle (e.g. after a fresh enqueue while already online). */
  drain: () => Promise<void>;
  /**
   * Dismiss a single abandoned item by id. Tries both stores; callers don't
   * need to know whether the id belongs to an issue or a return.
   */
  dismissAbandoned: (id: string) => Promise<void>;
}

export function useStockSync(): UseStockSyncResult {
  const online = useOnlineStatus();
  const [pendingIssuesCount, setPendingIssuesCount] = useState(0);
  const [pendingReturnsCount, setPendingReturnsCount] = useState(0);
  const [abandonedIssuesCount, setAbandonedIssuesCount] = useState(0);
  const [abandonedReturnsCount, setAbandonedReturnsCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const inFlight = useRef(false);
  const pendingReflush = useRef(false);

  // Derived totals — backwards-compatible with existing callers.
  const pendingCount = pendingIssuesCount + pendingReturnsCount;
  const abandonedCount = abandonedIssuesCount + abandonedReturnsCount;

  const refreshPendingCounts = useCallback(async () => {
    try {
      const [issues, returns] = await Promise.all([listQueued(), listQueuedReturns()]);
      setPendingIssuesCount(issues.length);
      setPendingReturnsCount(returns.length);
    } catch (err) {
      // IDB is unreachable (private mode, quota exceeded, Safari lockdown).
      // Log the underlying failure but retain the last-known count — a stale
      // count is less dangerous than hiding known-queued items.
      log.warn('useStockSync: list*Queued failed, keeping stale counts', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const refreshAbandonedCounts = useCallback(async () => {
    try {
      const [issues, returns] = await Promise.all([listAbandoned(), listAbandonedReturns()]);
      setAbandonedIssuesCount(issues.length);
      setAbandonedReturnsCount(returns.length);
    } catch (err) {
      log.warn('useStockSync: list*Abandoned failed, keeping stale counts', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const drain = useCallback(async () => {
    if (inFlight.current) {
      // Schedule a reflush once the current pass finishes (same pattern as
      // useAttendanceSync to avoid dropping an enqueue during active drain).
      pendingReflush.current = true;
      return;
    }
    inFlight.current = true;
    setSyncing(true);
    try {
      do {
        pendingReflush.current = false;

        // ------------------------------------------------------------------
        // Issue queue drain
        // ------------------------------------------------------------------
        const items = await listQueued();
        if (items.length > 0) {
          for (const item of items) {
            try {
              // The queued item's id IS the idempotency key (mirrors returns):
              // a retry after a mid-submit network drop dedupes to the same
              // picking server-side instead of issuing the stock twice.
              await submitIssue(item.draft, item.id);
              // 2xx — remove from queue.
              await dropQueued(item.id);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              const isTransient =
                !(err instanceof ApiError) ||
                err.status === 0 ||         // NETWORK_ERROR
                err.status === 408 ||        // timeout
                err.status === 425 ||        // too early
                err.status === 429 ||        // rate limit
                err.status >= 500;           // server error

              if (isTransient) {
                // Leave in queue; retry on next online event or poll tick.
                await bumpAttempt(item.id, message);
                // Back off: stop processing remaining items — don't burn the
                // queue against a broken backend.
                break;
              }

              // Permanent 4xx failure — increment attempts.
              await bumpAttempt(item.id, message);

              // Stock issue pickings carry a technician signature and serial
              // attestation. Silently deleting a failed picking means the
              // stores person has no record that the serials left the warehouse
              // — this is an audit gap. By moving to abandoned-issues, the item
              // is visible in the AbandonedIssuesBanner.
              if (item.attempts + 1 >= MAX_ATTEMPTS) {
                await abandonIssue({ ...item, attempts: item.attempts + 1, lastError: message });
              }
            }
          }
        }

        // ------------------------------------------------------------------
        // Return queue drain
        // ------------------------------------------------------------------
        const returnItems = await listQueuedReturns();
        for (const item of returnItems) {
          try {
            // The queued return's id IS the idempotency key.
            await submitReturn(item.draft, item.id);
            await dropQueuedReturn(item.id);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const isTransient =
              !(err instanceof ApiError) ||
              err.status === 0 ||         // NETWORK_ERROR
              err.status === 408 ||        // timeout
              err.status === 425 ||        // too early
              err.status === 429 ||        // rate limit
              err.status >= 500;           // server error

            if (isTransient) {
              await bumpReturnAttempt(item.id, message);
              // Back off: stop processing remaining return items.
              break;
            }

            // Permanent 4xx failure — increment attempts.
            await bumpReturnAttempt(item.id, message);

            // Mirror the issue audit pattern: abandoned returns are visible in
            // the AbandonedReturnsBanner for manual review.
            if (item.attempts + 1 >= MAX_ATTEMPTS) {
              await abandonReturn({
                ...item,
                attempts: item.attempts + 1,
                lastError: message,
              });
            }
          }
        }
      } while (pendingReflush.current);
    } finally {
      await refreshPendingCounts();
      await refreshAbandonedCounts();
      setSyncing(false);
      inFlight.current = false;
    }
  }, [refreshPendingCounts, refreshAbandonedCounts]);

  /**
   * Dismiss a single abandoned item after the stores person has manually
   * re-issued/returned or confirmed the item is no longer needed.
   * Tries both stores; callers don't need to know which type the id belongs to.
   */
  const dismissAbandoned = useCallback(async (id: string) => {
    await Promise.all([
      clearAbandoned(id).catch(() => undefined),
      clearAbandonedReturn(id).catch(() => undefined),
    ]);
    await refreshAbandonedCounts();
  }, [refreshAbandonedCounts]);

  // Seed pending + abandoned counts on mount. The `online` effect below fires
  // on mount too (because `online` starts as `true` from useOnlineStatus), so
  // a separate drain() call here would double-drain. Refresh counts only.
  useEffect(() => {
    void refreshPendingCounts();
    void refreshAbandonedCounts();
  }, [refreshPendingCounts, refreshAbandonedCounts]);

  // Drain on every online transition.
  useEffect(() => {
    if (online) void drain();
  }, [online, drain]);

  // Periodic poll while online + work pending (covers 3G blip edge case).
  useEffect(() => {
    if (!online || pendingCount === 0) return;
    const id = window.setInterval(() => { void drain(); }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [online, pendingCount, drain]);

  return {
    pendingCount,
    pendingIssuesCount,
    pendingReturnsCount,
    abandonedCount,
    abandonedIssuesCount,
    abandonedReturnsCount,
    syncing,
    drain,
    dismissAbandoned,
  };
}
