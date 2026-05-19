/**
 * Hook that owns the offline-queue lifecycle for /my/stores issue submissions.
 *
 * Mirrors `useAttendanceSync` (src/modules/attendance/portal/client/offline/)
 * verbatim except for:
 *  - IDB operations delegated to `queueIssue` (not `db.ts`)
 *  - Network call delegates to `submitIssue` from `../api` (DRY: same mapping
 *    shape used at submission time)
 *  - Simplified drain policy — no "dropped events" audit store needed for
 *    stocks (items can be reissued; a lost-shift on attendance has legal weight).
 *    A 4xx that still fails after MAX_ATTEMPTS is dropped silently from the
 *    queue (permanent client-side failures cannot be resolved by retrying).
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
 *  - 4xx (permanent) → `bumpAttempt`; if attempts >= MAX_ATTEMPTS, `dropQueued`.
 *    MAX_ATTEMPTS = 5 for field-stock: a permanent server-side validation error
 *    (e.g. invalid technicianId) will never self-heal; 5 attempts provides one
 *    retry burst per typical work day before the item is silently removed.
 *    The UI reads `lastError` from `listQueued()` directly if it needs to surface
 *    a reason to the stores person.
 */

// 🟢 WORKING: mirrors useAttendanceSync shape

import { useCallback, useEffect, useRef, useState } from 'react';

import { submitIssue, ApiError } from '../api';
import {
  bumpAttempt,
  dropQueued,
  listQueued,
} from './queueIssue';
import { useOnlineStatus } from './useOnlineStatus';

/** After this many failed 4xx attempts the queued issue is permanently dropped.
 *  5xx / network errors do NOT count toward this cap — they are transient. */
const MAX_ATTEMPTS = 5;

const POLL_INTERVAL_MS = 60_000;

export interface UseStockSyncResult {
  pendingCount: number;
  syncing: boolean;
  /** Force a sync cycle (e.g. after a fresh enqueue while already online). */
  drain: () => Promise<void>;
}

export function useStockSync(): UseStockSyncResult {
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const inFlight = useRef(false);
  const pendingReflush = useRef(false);

  const refreshPendingCount = useCallback(async () => {
    try {
      const queued = await listQueued();
      setPendingCount(queued.length);
    } catch {
      // IDB is unreachable (private mode, quota exceeded, Safari lockdown).
      // Keep the existing pendingCount rather than resetting to 0 — a stale
      // count is less dangerous than hiding known-queued items.
      setPendingCount(0);
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

            // Drop after MAX_ATTEMPTS: a permanent 4xx (e.g. invalid UUID,
            // validation error) will never self-heal client-side. After 5
            // attempts the entry is removed to prevent the queue from wedging.
            // The stores person must re-issue manually if needed.
            // Use the pre-bump count + 1 to avoid a second DB read.
            if (item.attempts + 1 >= MAX_ATTEMPTS) {
              await dropQueued(item.id);
            }
          }
        }
      } while (pendingReflush.current);
    } finally {
      await refreshPendingCount();
      setSyncing(false);
      inFlight.current = false;
    }
  }, [refreshPendingCount]);

  // Seed pending count on mount. The `online` effect below fires on mount
  // too (because `online` starts as `true` from useOnlineStatus), so a
  // separate drain() call here would double-drain. Refresh only.
  useEffect(() => {
    void refreshPendingCount();
  }, [refreshPendingCount]);

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

  return { pendingCount, syncing, drain };
}
