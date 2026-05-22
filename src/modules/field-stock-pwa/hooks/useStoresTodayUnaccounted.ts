/**
 * useStoresTodayUnaccounted — small fetch hook for the Today-summary tile
 * badge on StoresHub. Returns the total positive unaccounted count across
 * all of today's technicians for the current stores user.
 *
 * Returns null until the first fetch completes; failures resolve as 0
 * (badge hidden) rather than throwing — the badge is a hint, not a gate.
 */

import { useEffect, useState } from 'react';

interface ApiEnvelope {
  success?: boolean;
  data?: { rows?: Array<{ unaccounted_count: number }> };
}

export function useStoresTodayUnaccounted(): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    fetch('/api/my/stores/today', { credentials: 'include', signal: ctl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((envelope: ApiEnvelope | null) => {
        if (!envelope?.success || !envelope.data?.rows) {
          setCount(0);
          return;
        }
        const total = envelope.data.rows.reduce(
          (sum, r) => sum + (r.unaccounted_count > 0 ? r.unaccounted_count : 0),
          0,
        );
        setCount(total);
      })
      .catch(() => setCount(0));
    return () => ctl.abort();
  }, []);

  return count;
}
