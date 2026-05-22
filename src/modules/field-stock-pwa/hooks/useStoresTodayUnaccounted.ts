/**
 * useStoresTodayUnaccounted — small fetch hook for the Today-summary tile
 * badge on StoresHub. Returns the total positive unaccounted count across
 * all of today's technicians for the current stores user.
 *
 * Calls `/api/my/stores/today?summary=count` so the hub render only pulls
 * the scalar, not the full per-technician payload (the page-level fetch
 * still gets the rows). Decouples hub render-cost from row count.
 *
 * Returns null until the first fetch completes; failures resolve as 0
 * (badge hidden) rather than throwing — the badge is a hint, not a gate.
 */

import { useEffect, useState } from 'react';
import { log } from '@/lib/logger';

interface SummaryEnvelope {
  success?: boolean;
  data?: { unaccounted_count?: number };
}

export function useStoresTodayUnaccounted(): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    fetch('/api/my/stores/today?summary=count', { credentials: 'include', signal: ctl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((envelope: SummaryEnvelope | null) => {
        if (!envelope?.success || typeof envelope.data?.unaccounted_count !== 'number') {
          setCount(0);
          return;
        }
        setCount(envelope.data.unaccounted_count);
      })
      .catch((err) => {
        if ((err as { name?: string }).name === 'AbortError') return;
        log.warn('useStoresTodayUnaccounted fetch failed', { err }, 'field-stock-pwa');
        setCount(0);
      });
    return () => ctl.abort();
  }, []);

  return count;
}
