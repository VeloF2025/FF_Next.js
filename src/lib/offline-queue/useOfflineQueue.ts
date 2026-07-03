/**
 * React hook owning the offline-queue lifecycle for one workflow. Generalised
 * from src/modules/attendance/portal/client/offline/useAttendanceSync.ts.
 *
 * Flush triggers: transition to online, mount-while-online, manual syncNow(),
 * and a 60s poll whenever there is work AND we are online (covers the case
 * where the browser never fires an `online` edge after a brief signal blip).
 * Deliberately page-context driven — NOT the SW Background Sync API.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { log } from '@/lib/logger';
import { useOnlineStatus } from '@/lib/hooks/useOnlineStatus';
import { OfflineQueueStore } from './store';
import { defaultClassify, flushQueue } from './flush';
import type {
  DroppedItem,
  FlushReport,
  OfflineQueueConfig,
  QueuedItem,
} from './types';

const POLL_INTERVAL_MS = 60_000;

export interface UseOfflineQueueResult<TPayload> {
  online: boolean;
  pendingCount: number;
  syncing: boolean;
  queueUnavailable: boolean;
  dropped: DroppedItem<TPayload>[];
  lastReport: FlushReport | null;
  enqueue: (payload: TPayload) => Promise<void>;
  syncNow: () => Promise<void>;
  acknowledgeDropped: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useOfflineQueue<TPayload>(
  config: OfflineQueueConfig<TPayload>
): UseOfflineQueueResult<TPayload> {
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [queueUnavailable, setQueueUnavailable] = useState(false);
  const [dropped, setDropped] = useState<DroppedItem<TPayload>[]>([]);
  const [lastReport, setLastReport] = useState<FlushReport | null>(null);
  const inFlight = useRef(false);
  const pendingReflush = useRef(false);

  const store = useMemo(
    () => new OfflineQueueStore<TPayload>(config.queueName, config.maxQueueSize ?? 50),
    [config.queueName, config.maxQueueSize]
  );
  const classify = config.classify ?? ((err: unknown) => defaultClassify(err));
  const maxAttempts = config.maxAttemptsBeforeDrain;

  const refresh = useCallback(async () => {
    try {
      const [count, droppedRows] = await Promise.all([store.countPending(), store.listDropped()]);
      setPendingCount(count);
      setDropped(droppedRows);
      setQueueUnavailable(false);
    } catch (err) {
      // IDB genuinely unreachable (private mode / quota / Safari lockdown).
      // Surface it so the UI can warn — never let it look like "empty queue".
      log.error('[offline-queue] refresh failed', { queue: config.queueName, err });
      setPendingCount(0);
      setQueueUnavailable(true);
    }
  }, [store, config.queueName]);

  const enqueue = useCallback(
    async (payload: TPayload) => {
      const item: QueuedItem<TPayload> = {
        id: newId(),
        payload,
        queuedAt: new Date().toISOString(),
        attempts: 0,
      };
      await store.enqueue(item);
      await refresh();
    },
    [store, refresh]
  );

  const syncNow = useCallback(async () => {
    if (inFlight.current) {
      pendingReflush.current = true;
      return;
    }
    inFlight.current = true;
    setSyncing(true);
    try {
      do {
        pendingReflush.current = false;
        const items = await store.listPending();
        if (items.length === 0) {
          setLastReport({ attempted: 0, drained: 0, kept: 0, failures: [] });
          break;
        }
        const report = await flushQueue(
          items,
          async (item) => {
            try {
              await config.submit(item.payload);
              return { drain: true };
            } catch (err) {
              return classify(err, item.payload);
            }
          },
          {
            onDrain: (id, reason) => {
              const it = items.find((i) => i.id === id);
              return it ? store.drop(it, reason) : store.deletePending(id);
            },
            onTransient: (id, message) => store.bumpAttempts(id, message),
            onAbandon: (id, reason) => {
              const it = items.find((i) => i.id === id);
              return it ? store.drop(it, reason) : store.deletePending(id);
            },
          },
          maxAttempts
        );
        setLastReport(report);
      } while (pendingReflush.current);
    } catch (err) {
      log.error('[offline-queue] sync failed', { queue: config.queueName, err });
      setQueueUnavailable(true);
    } finally {
      await refresh();
      setSyncing(false);
      inFlight.current = false;
    }
    // config.submit/classify are stable per render for typical callers; the
    // queueName-keyed store memo bounds re-creation.
  }, [store, refresh, config, classify, maxAttempts]);

  const acknowledgeDropped = useCallback(
    async (id: string) => {
      await store.acknowledgeDropped(id);
      await refresh();
    },
    [store, refresh]
  );

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (online) void syncNow(); }, [online, syncNow]);
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
    dropped,
    lastReport,
    enqueue,
    syncNow,
    acknowledgeDropped,
    refresh,
  };
}
