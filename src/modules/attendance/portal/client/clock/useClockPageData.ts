import React from 'react';
import type { NextRouter } from 'next/router';

import { ApiError, getSession } from '../api';
import type { SessionResponse } from '../api';
import { getCurrentAttendance, isDailyResultStatus } from '../attendanceStateApi';
import type { CurrentAttendanceResponse } from '../attendanceStateApi';
import {
  loadAttendanceEligibilitySnapshot,
  saveAttendanceEligibilitySnapshot,
} from './attendanceEligibilitySnapshot';

type LoadState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: null; error: string };

const loading = <T,>(): LoadState<T> => ({ status: 'loading', data: null, error: null });

export function useClockPageData(router: NextRouter) {
  const [session, setSession] = React.useState<LoadState<SessionResponse>>(loading);
  const [attendance, setAttendance] = React.useState<LoadState<CurrentAttendanceResponse>>(loading);
  const [requestVersion, setRequestVersion] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setSession(loading());
    setAttendance(loading());
    getSession()
      .then(async (value) => {
        if (cancelled) return;
        if (!value.session) {
          setSession({ status: 'error', data: null, error: 'Could not verify your session. Please sign in again.' });
          await router.replace('/my');
          return;
        }
        setSession({ status: 'ready', data: value, error: null });
        try {
          const current = await getCurrentAttendance();
          if (cancelled) return;
          if (!isDailyResultStatus(current?.result?.status)) {
            setAttendance({ status: 'error', data: null, error: 'Attendance status unavailable. Clock actions are paused.' });
            return;
          }
          saveAttendanceEligibilitySnapshot(value.session.staffId, current);
          setAttendance({ status: 'ready', data: current, error: null });
        } catch (error) {
          if (cancelled) return;
          const cached = error instanceof ApiError && error.status === 0
            ? loadAttendanceEligibilitySnapshot(value.session.staffId)
            : null;
          setAttendance(cached
            ? { status: 'ready', data: cached, error: null }
            : { status: 'error', data: null,
              error: 'Schedule unavailable. Clock actions are paused until it can be checked.' });
        }
      })
      .catch(async (error: unknown) => {
        if (cancelled) return;
        setSession({ status: 'error', data: null, error: 'Could not verify your session. Please sign in again.' });
        if (error instanceof ApiError && error.status === 401) await router.replace('/my');
      });

    return () => { cancelled = true; };
  }, [requestVersion, router]);

  return {
    session,
    attendance,
    retry: () => setRequestVersion((value) => value + 1),
  };
}
