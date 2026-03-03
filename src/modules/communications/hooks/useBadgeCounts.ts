/**
 * useBadgeCounts — polls /api/communications/badge-counts every 30 seconds
 * and returns unread/pending indicator counts for nav badges.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const POLL_INTERVAL_MS = 30_000;

export interface BadgeCounts {
  inbox: number;
  notifications: number;
  actionItems: number;
}

const DEFAULT_COUNTS: BadgeCounts = {
  inbox: 0,
  notifications: 0,
  actionItems: 0,
};

export function useBadgeCounts(): BadgeCounts {
  const [counts, setCounts] = useState<BadgeCounts>(DEFAULT_COUNTS);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/communications/badge-counts', {
        credentials: 'include',
      });
      const json = await res.json();
      if (json.success && json.data) {
        setCounts({
          inbox: Number(json.data.inbox ?? 0),
          notifications: Number(json.data.notifications ?? 0),
          actionItems: Number(json.data.actionItems ?? 0),
        });
      }
    } catch {
      // Silently ignore polling errors — stale counts are acceptable
    }
  }, []);

  useEffect(() => {
    fetchCounts();
    pollRef.current = setInterval(fetchCounts, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchCounts]);

  return counts;
}
