import React from 'react';
import type { NextRouter } from 'next/router';

import { ApiError, getCorrectionHints, getHistory, getSession } from '../api';
import type { ClockEntry, CorrectionHints, SessionResponse } from '../api';
import { getCorrectionTarget } from '../attendanceStateApi';

export function useCorrectionPageData(
  router: NextRouter,
  requestedEntryId: string,
  exceptionId: string,
) {
  const [session, setSession] = React.useState<SessionResponse | null>(null);
  const [hints, setHints] = React.useState<CorrectionHints | null>(null);
  const [entry, setEntry] = React.useState<ClockEntry | null>(null);
  const [entryId, setEntryId] = React.useState(exceptionId ? '' : requestedEntryId);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadError(null);
      setEntry(null);
      setEntryId(exceptionId ? '' : requestedEntryId);
      try {
        const currentSession = await getSession();
        if (cancelled) return;
        if (!currentSession.session) {
          await router.replace('/my');
          return;
        }
        setSession(currentSession);
        const [hintResponse, history, target] = await Promise.all([
          getCorrectionHints(),
          getHistory(30),
          exceptionId ? getCorrectionTarget(exceptionId) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        const exactEntryId = target?.entryId ?? requestedEntryId;
        setHints(hintResponse.hints);
        setEntryId(exactEntryId);
        setEntry(history.entries.find((item) => item.entryId === exactEntryId) ?? null);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          await router.replace('/my');
          return;
        }
        setLoadError(error instanceof Error ? error.message : 'Could not load the correction form.');
      }
    })();
    return () => { cancelled = true; };
  }, [exceptionId, requestedEntryId, router]);

  return { session, hints, entry, entryId, loadError };
}
