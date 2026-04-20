/**
 * Hook that owns the offline-queue lifecycle for /my/attendance.
 *
 * Triggers a flush whenever ANY of:
 *   1. the browser transitions to online,
 *   2. the component mounts and we are online,
 *   3. the user taps "Sync now",
 *   4. a periodic poll (every 60s) when there is work to do AND we are online.
 *
 * The poll covers a subtle real-world case: the browser may not fire an
 * `online` event if cell coverage drops mid-request and returns a second
 * later (the window never saw "offline"), but the event still got enqueued
 * via NETWORK_ERROR. Without the poll, that event sits until the user
 * manually retries.
 *
 * `queueUnavailable` flips to `true` when IndexedDB is unreachable (private
 * mode, quota exhausted, Safari profile lockdown). The UI must render a red
 * banner — without the flag, a device-wide IDB break silently looks like
 * "empty queue" and clock events sent via the offline path would vanish.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, clockIn, clockOut } from '../api';
import {
  bumpPendingClockEventAttempts,
  countPendingClockEvents,
  deletePendingClockEvent,
  dropPendingClockEvent,
  listPendingClockEvents,
  type PendingClockEvent,
} from './db';
import {
  classifyApiError,
  flushQueue,
  type FlushReport,
  type SubmitResult,
} from './sync';
import { useOnlineStatus } from './useOnlineStatus';

const POLL_INTERVAL_MS = 60_000;

export interface UseAttendanceSyncResult {
  online: boolean;
  pendingCount: number;
  syncing: boolean;
  queueUnavailable: boolean;
  lastReport: FlushReport | null;
  syncNow: () => Promise<void>;
  refreshPendingCount: () => Promise<void>;
}

async function submitEvent(event: PendingClockEvent): Promise<SubmitResult> {
  const call = event.action === 'in' ? clockIn : clockOut;
  try {
    await call({
      lat: event.lat,
      lon: event.lon,
      accuracyM: event.accuracyM,
      clientOccurredAt: event.clientOccurredAt,
      selfieBase64: event.selfieBase64,
      deviceFingerprint: event.deviceFingerprint,
    });
    return { drain: true };
  } catch (err) {
    if (err instanceof ApiError) {
      return classifyApiError(err, event.action);
    }
    return { drain: false, errorMessage: err instanceof Error ? err.message : String(err) };
  }
}

export function useAttendanceSync(): UseAttendanceSyncResult {
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [queueUnavailable, setQueueUnavailable] = useState(false);
  const [lastReport, setLastReport] = useState<FlushReport | null>(null);
  const inFlight = useRef(false);
  const pendingReflush = useRef(false);

  const refreshPendingCount = useCallback(async () => {
    try {
      const count = await countPendingClockEvents();
      setPendingCount(count);
      setQueueUnavailable(false);
    } catch {
      // IDB genuinely unreachable — not just "no data". Surfacing this as
      // `queueUnavailable = true` lets the UI render a red banner so the
      // user doesn't think their submissions are being saved when they
      // aren't.
      setPendingCount(0);
      setQueueUnavailable(true);
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (inFlight.current) {
      // Schedule a reflush once the current pass finishes. Without this a
      // navigator.onLine edge during a manual "Sync now" (user taps while a
      // flush is already running) gets dropped silently.
      pendingReflush.current = true;
      return;
    }
    inFlight.current = true;
    setSyncing(true);
    try {
      do {
        pendingReflush.current = false;
        const events = await listPendingClockEvents();
        if (events.length === 0) {
          setLastReport({ attempted: 0, drained: 0, kept: 0, failures: [] });
          break;
        }
        const report = await flushQueue(events, submitEvent, {
          onDrain: (id, reason) => {
            const ev = events.find((e) => e.id === id);
            return ev
              ? dropPendingClockEvent(ev, reason)
              : deletePendingClockEvent(id);
          },
          onTransient: (id, message) => bumpPendingClockEventAttempts(id, message),
          onAbandon: (id, reason) => {
            const ev = events.find((e) => e.id === id);
            return ev
              ? dropPendingClockEvent(ev, reason)
              : deletePendingClockEvent(id);
          },
        });
        setLastReport(report);
      } while (pendingReflush.current);
    } catch {
      // A failure during list/drop itself — mark the queue unavailable so
      // the UI surfaces it. Does NOT silently clear pending events.
      setQueueUnavailable(true);
    } finally {
      await refreshPendingCount();
      setSyncing(false);
      inFlight.current = false;
    }
  }, [refreshPendingCount]);

  useEffect(() => {
    void refreshPendingCount();
  }, [refreshPendingCount]);

  useEffect(() => {
    if (online) void syncNow();
  }, [online, syncNow]);

  // Periodic poll: re-try the queue every minute whenever there is work AND
  // we believe we're online. Cheap, and covers the case where the browser
  // never fires an `online` edge (transient 3G blip mid-fetch).
  useEffect(() => {
    if (!online || pendingCount === 0) return;
    const id = window.setInterval(() => { void syncNow(); }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [online, pendingCount, syncNow]);

  return {
    online,
    pendingCount,
    syncing,
    queueUnavailable,
    lastReport,
    syncNow,
    refreshPendingCount,
  };
}
