/**
 * Page-context retry cadence for a SiteCam job queued offline (Task 6).
 * Mirrors `useOfflineQueue`'s online-edge + mount + 60s-poll + manual
 * triggers (deliberately page-context, NOT the SW Background Sync API) —
 * SiteCam's keyed job-document store isn't a FIFO queue, so this hook
 * re-implements just the trigger SHAPE against a single job's `attemptFlush`,
 * rather than reusing `useOfflineQueue`'s item-list engine.
 *
 * All outcome handling (setting `uploadResult`, flipping `queued`, surfacing
 * an error message) lives in the caller's `attemptFlush` closure — this hook
 * owns ONLY the cadence: when to call it, and the transient `flushing` flag.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { log } from '@/lib/logger';
import { useOnlineStatus } from '@/lib/hooks/useOnlineStatus';

const MODULE = 'useSiteCamFlush';
const POLL_INTERVAL_MS = 60_000;

export interface UseSiteCamFlushResult {
  online: boolean;
  flushing: boolean;
  /** Always attempts, regardless of `hasError` — the "Try again" affordance. */
  syncNow: () => Promise<void>;
}

/**
 * @param queued Whether a submission is currently queued and awaiting flush.
 * @param hasError Whether the last attempt ended in a definitive (non-retryable)
 *   error. While true, the automatic online-edge/poll triggers stop firing —
 *   mirroring `useOfflineQueue`'s dropped-item contract (stop hammering a
 *   permanently-rejected submission; the technician must retry manually).
 * @param attemptFlush Performs one submit attempt and applies its outcome to
 *   the caller's own state. Must not throw for expected outcomes (network/4xx/5xx
 *   are all handled internally by `attemptSiteCamSubmit`) — a throw here is
 *   logged and swallowed so the cadence keeps running.
 */
export function useSiteCamFlush(
  queued: boolean,
  hasError: boolean,
  attemptFlush: () => Promise<void>,
): UseSiteCamFlushResult {
  const online = useOnlineStatus();
  const [flushing, setFlushing] = useState(false);
  const inFlight = useRef(false);

  const syncNow = useCallback(async () => {
    if (inFlight.current || !queued) return;
    inFlight.current = true;
    setFlushing(true);
    try {
      await attemptFlush();
    } catch (err) {
      log.warn('SiteCam flush attempt failed (will retry)', { err: String(err) }, MODULE);
    } finally {
      setFlushing(false);
      inFlight.current = false;
    }
  }, [queued, attemptFlush]);

  useEffect(() => {
    if (online && queued && !hasError) void syncNow();
  }, [online, queued, hasError, syncNow]);

  useEffect(() => {
    if (!online || !queued || hasError) return;
    const id = window.setInterval(() => { void syncNow(); }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [online, queued, hasError, syncNow]);

  return { online, flushing, syncNow };
}
