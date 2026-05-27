/**
 * usePPLookupPoller — manages the 1Map lookup-status polling lifecycle.
 * Extracted from usePPData to keep that hook within the 300-line file limit.
 */

import { useRef, useCallback } from 'react';
import { log } from '@/lib/logger';
import { type LookupStatus } from './ppDataShared';

interface PollCallbacks {
  setLookupStatus: (s: LookupStatus | null) => void;
  onComplete: () => void;
}

export function usePPLookupPoller({ setLookupStatus, onComplete }: PollCallbacks) {
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return; // already running
    pollRef.current = setInterval(() => {
      fetch('/api/activate/import-pp-data?action=lookup-status')
        .then(r => r.json())
        .then((d: { success: boolean; data?: LookupStatus }) => {
          if (d.success && d.data) {
            setLookupStatus(d.data);
            if (d.data.status !== 'running') {
              stopPolling();
              if (d.data.status === 'success') onComplete();
            }
          }
        })
        .catch((err: unknown) => { log.error('Lookup poll failed', { err }, 'usePPLookupPoller'); });
    }, 3000);
  }, [setLookupStatus, onComplete, stopPolling]);

  const fetchLookupStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/activate/import-pp-data?action=lookup-status');
      const data: { success: boolean; data?: LookupStatus } = await res.json();
      if (data.success && data.data) {
        setLookupStatus(data.data);
        if (data.data.status === 'running') {
          startPolling();
        } else {
          stopPolling();
          if (data.data.status === 'success') onComplete();
        }
      }
    } catch (err) {
      log.error('Failed to fetch lookup status', { err }, 'usePPLookupPoller');
    }
  }, [setLookupStatus, startPolling, stopPolling, onComplete]);

  return { fetchLookupStatus, stopPolling };
}
