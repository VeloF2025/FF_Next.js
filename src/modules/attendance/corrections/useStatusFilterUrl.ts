/**
 * Shared URL-sync helper for the status-filter tab bar on the two
 * corrections pages (staff self-view and supervisor queue). The `?status=`
 * query param is the source of truth; tab clicks use `router.replace`
 * (shallow) to avoid history pollution, and the default tab strips the
 * param so the clean URL is `?` rather than `?status=pending`.
 *
 * Extracted from pages/my/attendance/corrections.tsx and
 * pages/staff/attendance/corrections.tsx in #1421. Keeping a single
 * source avoids the two pages drifting — if a future engineer adds a
 * new status tab, the bug where only one page accepts the new value
 * becomes structurally impossible.
 */

import * as React from 'react';
import { useRouter } from 'next/router';

export interface StatusFilterUrlSyncResult<T extends string> {
  statusFilter: T;
  setStatusFilter: (next: T) => void;
}

/**
 * Keep a status-filter state variable in sync with `?status=...` in the URL.
 *
 * @param validFilters A readonly list of every accepted filter value
 *                     (e.g. ['pending', 'approved', 'rejected', 'cancelled',
 *                     'all']). Values not in this list are rejected and fall
 *                     back to `defaultFilter`.
 * @param defaultFilter The filter value that renders with no query param.
 *                      Clicking this tab strips `?status=` from the URL.
 */
export function useStatusFilterUrlSync<T extends string>(
  validFilters: readonly T[],
  defaultFilter: T
): StatusFilterUrlSyncResult<T> {
  const router = useRouter();
  const [statusFilter, setStatusFilterState] = React.useState<T>(defaultFilter);

  const parse = React.useCallback(
    (raw: unknown): T =>
      typeof raw === 'string' && (validFilters as readonly string[]).includes(raw)
        ? (raw as T)
        : defaultFilter,
    [validFilters, defaultFilter]
  );

  // Reflect URL → state. Handles deep-links, back/forward, and returns
  // from nested routes (e.g. corrections/new → browser back).
  React.useEffect(() => {
    if (!router.isReady) return;
    const next = parse(router.query.status);
    setStatusFilterState((prev) => (prev === next ? prev : next));
  }, [router.isReady, router.query.status, parse]);

  const setStatusFilter = React.useCallback(
    (next: T) => {
      setStatusFilterState(next);
      if (!router.isReady) return;
      const { status: _prev, ...restQuery } = router.query;
      const nextQuery =
        next === defaultFilter ? restQuery : { ...restQuery, status: next };
      router.replace(
        { pathname: router.pathname, query: nextQuery },
        undefined,
        { shallow: true }
      );
    },
    [router, defaultFilter]
  );

  return { statusFilter, setStatusFilter };
}
