/**
 * Hook that owns the offline-queue lifecycle for /my/stores issue submissions.
 *
 * Mirrors `useAttendanceSync` (src/modules/attendance/portal/client/offline/)
 * verbatim except for:
 *  - IDB operations delegated to `queueIssue` (not `db.ts`)
 *  - Network call delegates to `submitIssue` from `../api` (DRY: same mapping
 *    shape used at submission time)
 *  - Audit-store pattern for permanently-failed items: stock pickings are signed
 *    attestation artefacts, so a 4xx that exceeds MAX_ATTEMPTS is moved to the
 *    'abandoned-issues' store rather than silently deleted. The stores person sees
 *    them in the AbandonedIssuesBanner and can re-issue or dismiss manually.
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
 *  - 2xx → `dropQueued(id)`.
 *  - Network error / 5xx / 408 / 429 → transient; `bumpAttempt` and leave.
 *  - 4xx (permanent) → `bumpAttempt`; if attempts >= MAX_ATTEMPTS, `abandonIssue`.
 *    MAX_ATTEMPTS = 5 for field-stock: a permanent server-side validation error
 *    (e.g. invalid technicianId) will never self-heal; 5 attempts provides one
 *    retry burst per typical work day before the item is escalated to abandoned.
 */

// 🟢 WORKING: mirrors useAttendanceSync shape

import { useCallback, useEffect, useRef, useState } from 'react';

import { log } from '@/lib/logger';
import { submitIssue, ApiError } from '../api';
import {
  abandonIssue,
  bumpAttempt,
  clearAbandoned,
  dropQueued,
  listAbandoned,
  listQueued,
} from './queueIssue';
import { useOnlineStatus } from '@/lib/hooks/useOnlineStatus';

/** After this many failed 4xx attempts the queued issue is permanently dropped.
 *  5xx / network errors do NOT count toward this cap — they are transient. */
const MAX_ATTEMPTS = 5;

const POLL_INTERVAL_MS = 60_000;

export interface UseStockSyncResult {
  pendingCount: number;
  /** Number of permanently-failed issues waiting for manual review. */
  abandonedCount: number;
  syncing: boolean;
  /** Force a sync cycle (e.g. after a fresh enqueue while already online). */
  drain: () => Promise<void>;
  /**
   * Dismiss a single abandoned issue from the audit store.
   * Call after the stores person has handled the item manually.
   */
  dismissAbandoned: (id: string) => Promise<void>;
}

export function useStockSync(): UseStockSyncResult {
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [abandonedCount, setAbandonedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const inFlight = useRef(false);
  const pendingReflush = useRef(false);

  const refreshPendingCount = useCallback(async () => {
    try {
      const queued = await listQueued();
      setPendingCount(queued.length);
    } catch (err) {
      // IDB is unreachable (private mode, quota exceeded, Safari lockdown).
      // Log the underlying failure but retain the last-known count — a stale
      // count is less dangerous than hiding known-queued items.
      log.warn('useStockSync: listQueued failed, keeping stale pendingCount', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const refreshAbandonedCount = useCallback(async () => {
    try {
      const abandoned = await listAbandoned();
      setAbandonedCount(abandoned.length);
    } catch (err) {
      log.warn('useStockSync: listAbandoned failed, keeping stale abandonedCount', {
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
        const items = await listQueued();
        if (items.length === 0) break;

        for (const item of items) {
          try {
            await submitIssue(item.draft);
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
              // Back off: stop processing remaining items (same as attendance
              // sync.ts early-exit on transient) — don't burn the queue against
              // a broken backend.
              break;
            }

            // Permanent 4xx failure — increment attempts.
            await bumpAttempt(item.id, message);

            // ==================================================================
            // Why we abandon rather than silently drop:
            //   Stock issue pickings carry a technician signature and serial
            //   attestation. Silently deleting a failed picking means the
            //   stores person has no record that the serials left the warehouse
            //   — this is an audit gap. By moving to abandoned-issues, the item
            //   is visible in the AbandonedIssuesBanner and can be re-issued or
            //   acknowledged by a human.
            //
            // Abandoned items are NOT auto-retried — the 4xx is permanent
            //   (e.g. invalid technicianId, validation error) and retrying would
            //   just burn more attempts with the same result. The stores person
            //   must take action.
            //
            // Audit store size:
            //   The store grows unbounded today. The UX provides a per-item
            //   "Dismiss" button (clearAbandoned) as the only drain. Auto-archive
            //   after 30 days is a future ticket.
            //
            // Use the pre-bump count + 1 to avoid a second DB read.
            // ==================================================================
            if (item.attempts + 1 >= MAX_ATTEMPTS) {
              await abandonIssue({ ...item, attempts: item.attempts + 1, lastError: message });
            }
          }
        }
      } while (pendingReflush.current);
    } finally {
      await refreshPendingCount();
      await refreshAbandonedCount();
      setSyncing(false);
      inFlight.current = false;
    }
  }, [refreshPendingCount, refreshAbandonedCount]);

  /**
   * Dismiss a single abandoned issue after the stores person has manually
   * re-issued or confirmed the item is no longer needed.
   */
  const dismissAbandoned = useCallback(async (id: string) => {
    await clearAbandoned(id);
    await refreshAbandonedCount();
  }, [refreshAbandonedCount]);

  // Seed pending + abandoned counts on mount. The `online` effect below fires
  // on mount too (because `online` starts as `true` from useOnlineStatus), so
  // a separate drain() call here would double-drain. Refresh counts only.
  useEffect(() => {
    void refreshPendingCount();
    void refreshAbandonedCount();
  }, [refreshPendingCount, refreshAbandonedCount]);

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

  return { pendingCount, abandonedCount, syncing, drain, dismissAbandoned };
}
