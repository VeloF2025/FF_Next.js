import { useCallback, useEffect, useRef, useState } from 'react';
import { log } from '@/lib/logger';
import { confirmsBulkLocks, confirmsLock, positiveLockVersion } from './lockReadback';
export interface PeriodBlocker {
  staffId: string;
  workDate: string;
  kind: string;
  owner: 'worker' | 'supervisor' | 'hr';
  actionUrl: string;
  exceptionId: string | null;
  exceptionKind: string | null;
  status: string;
}
export interface PeriodReadiness {
  weekStartDate: string;
  weekEndDate: string;
  activeStaffCount: number;
  expectedDayCount: number;
  approvedDayCount: number;
  blockerCount: number;
  unapprovedOvertimeHours: number;
  unapprovedSundayHours: number;
  reconciliationLastSucceededAt: string | null;
  reconciliationFresh: boolean;
  readyToLock: boolean;
  blockers: PeriodBlocker[];
}
export interface WeeklyLockView {
  week_start_date: string;
  locked_at: string;
  locked_by: string;
  lock_reason: string | null;
  unlocked_at: string | null;
  unlocked_by: string | null;
  unlock_reason: string | null;
  lock_version: string | number | null;
  latest_action: 'lock' | 'unlock' | 'relock' | null;
  latest_actor_user_id: string | null;
  latest_reason: string | null;
  latest_recorded_at: string | null;
}
export interface BulkWeekReadiness {
  weekStartDate: string;
  readiness: PeriodReadiness | null;
  loading: boolean;
  error: string | null;
}
export const LOCK_STALE_MESSAGE =
  'Attendance readiness changed before the lock was saved. The current week was refreshed; review it and try again.';
function message(body: unknown, fallback: string): string {
  const value = (body as { error?: { message?: string } } | null)?.error?.message;
  return value ?? fallback;
}
async function body(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}
async function getReadiness(week: string): Promise<PeriodReadiness> {
  const response = await fetch(
    `/api/staff/attendance-period-readiness?week_start_date=${encodeURIComponent(week)}`,
    { credentials: 'same-origin' }
  );
  const parsed = await body(response);
  if (!response.ok) {
    if (response.status === 403) throw new Error('You do not have permission to view attendance readiness.');
    throw new Error(message(parsed, `HTTP ${response.status}`));
  }
  return (parsed as { success: true; data: PeriodReadiness }).data;
}
async function getLock(week: string): Promise<WeeklyLockView | null> {
  const response = await fetch(
    `/api/staff/attendance-weekly-locks?week_start_date=${encodeURIComponent(week)}`, {
    credentials: 'same-origin',
  });
  const parsed = await body(response);
  if (!response.ok) throw new Error(message(parsed, `HTTP ${response.status}`));
  return (parsed as { success: true; data: { lock: WeeklyLockView | null } }).data.lock;
}
function replaceLock(rows: WeeklyLockView[], week: string, next: WeeklyLockView | null) {
  const other = rows.filter((row) => row.week_start_date !== week);
  return next ? [...other, next] : other;
}
async function getWeekStates(weeks: string[]) {
  return Promise.all(weeks.map(async (week) => {
    const [readiness, lock] = await Promise.all([getReadiness(week), getLock(week)]);
    return { readiness, lock };
  }));
}
export function usePeriodReadiness(weekStartDate: string | null) {
  const [readiness, setReadiness] = useState<PeriodReadiness | null>(null);
  const [locks, setLocks] = useState<WeeklyLockView[]>([]);
  const [bulkWeeks, setBulkWeeks] = useState<BulkWeekReadiness[]>([]);
  const [loading, setLoading] = useState(Boolean(weekStartDate));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleMessage, setStaleMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const busyRef = useRef(false);
  const loadRequestRef = useRef(0);
  const mutationRef = useRef(0);
  const contextRef = useRef({ week: weekStartDate, generation: 0 });
  if (contextRef.current.week !== weekStartDate) {
    contextRef.current = { week: weekStartDate, generation: contextRef.current.generation + 1 };
  }

  const load = useCallback(async (showLoading = true) => {
    if (!weekStartDate) return null;
    const requestId = ++loadRequestRef.current;
    const contextGeneration = contextRef.current.generation;
    const current = () => requestId === loadRequestRef.current &&
      contextRef.current.generation === contextGeneration && contextRef.current.week === weekStartDate;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [nextReadiness, nextLock] = await Promise.all([
        getReadiness(weekStartDate), getLock(weekStartDate),
      ]);
      if (!current()) return null;
      const nextLocks = nextLock ? [nextLock] : [];
      setReadiness(nextReadiness);
      setLocks(nextLocks);
      setBulkWeeks((current) => {
        const existing = current.length > 0 ? current : [{
          weekStartDate, readiness: null, loading: false, error: null,
        }];
        return existing.map((item) => item.weekStartDate === weekStartDate
          ? { ...item, readiness: nextReadiness, loading: false, error: null } : item);
      });
      setLastCheckedAt(new Date().toISOString());
      return { readiness: nextReadiness, locks: nextLocks };
    } catch (caught) {
      if (!current()) return null;
      const nextError = caught instanceof Error ? caught.message : String(caught);
      setError(nextError);
      log.error('[attendance-readiness] load failed', { weekStartDate, error: nextError });
      return null;
    } finally {
      if (showLoading && current()) setLoading(false);
    }
  }, [weekStartDate]);

  useEffect(() => {
    ++mutationRef.current;
    const loadRequests = loadRequestRef;
    const mutations = mutationRef;
    busyRef.current = false; setBusy(false); setError(null); setStaleMessage(null); setSuccess(null);
    setReadiness(null);
    setLocks([]);
    setBulkWeeks(weekStartDate ? [{ weekStartDate, readiness: null, loading: true, error: null }] : []);
    if (weekStartDate) void load(); else { ++loadRequestRef.current; setLoading(false); }
    return () => {
      ++loadRequests.current;
      ++mutations.current;
    };
  }, [load, weekStartDate]);

  const submit = useCallback(async (action: 'lock' | 'unlock', reason: string) => {
    if (!weekStartDate || busyRef.current) return;
    const operationId = ++mutationRef.current;
    const contextGeneration = contextRef.current.generation;
    const current = () => operationId === mutationRef.current &&
      contextRef.current.generation === contextGeneration && contextRef.current.week === weekStartDate;
    busyRef.current = true;
    setBusy(true); setError(null); setStaleMessage(null); setSuccess(null);
    try {
      const response = await fetch('/api/staff/attendance-weekly-locks', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week_start_date: weekStartDate, action,
          lock_reason: action === 'lock' ? reason.trim() : undefined,
          unlock_reason: action === 'unlock' ? reason.trim() : undefined }),
      });
      const parsed = await body(response);
      if (!current()) return;
      if (!response.ok) {
        if (response.status === 409) {
          setStaleMessage(LOCK_STALE_MESSAGE);
          await load(false);
          return;
        }
        throw new Error(message(parsed, `HTTP ${response.status}`));
      }
      const persisted = (parsed as { success: true; data: { lock: {
        weekStartDate: string; version: number; active: boolean;
      } } }).data.lock;
      const readback = await load(false);
      if (!current()) return;
      if (!readback || !confirmsLock(persisted, readback.locks)) {
        throw new Error('Lock command was saved, but the active lock readback did not match. Reload before continuing.');
      }
      setSuccess(`${action === 'lock' ? 'Lock' : 'Unlock'} saved and confirmed from server readback.`);
    } catch (caught) {
      if (!current()) return;
      const nextError = caught instanceof Error ? caught.message : String(caught);
      setError(nextError);
      log.error('[attendance-readiness] command failed', { weekStartDate, action, error: nextError });
    } finally {
      if (current()) { busyRef.current = false; setBusy(false); }
    }
  }, [load, weekStartDate]);

  const addBulkWeek = useCallback(async (week: string) => {
    if (bulkWeeks.some((item) => item.weekStartDate === week)) return;
    const contextGeneration = contextRef.current.generation;
    const current = () => contextRef.current.generation === contextGeneration &&
      contextRef.current.week === weekStartDate;
    setBulkWeeks((current) => [...current, { weekStartDate: week, readiness: null, loading: true, error: null }]);
    try {
      const [next, nextLock] = await Promise.all([getReadiness(week), getLock(week)]);
      if (!current()) return;
      setLocks((current) => replaceLock(current, week, nextLock));
      setBulkWeeks((current) => current.map((item) => item.weekStartDate === week
        ? { ...item, readiness: next, loading: false, error: null } : item));
    } catch (caught) {
      if (!current()) return;
      const nextError = caught instanceof Error ? caught.message : String(caught);
      setBulkWeeks((current) => current.map((item) => item.weekStartDate === week
        ? { ...item, loading: false, error: nextError } : item));
    }
  }, [bulkWeeks, weekStartDate]);

  const bulkLock = useCallback(async (weeks: string[], reason: string) => {
    if (busyRef.current || weeks.length === 0 ||
      !weeks.every((week) => bulkWeeks.find((item) => item.weekStartDate === week)?.readiness?.readyToLock)) return;
    const before = new Map<string, number>();
    for (const week of weeks) {
      const prior = locks.find((row) => row.week_start_date === week);
      const version = prior ? positiveLockVersion(prior.lock_version) : 0;
      if (version === null || prior?.unlocked_at === null) {
        setSuccess(null); setStaleMessage(null);
        setError('Bulk lock cannot be correlated because a pre-submit lock state is not safely versioned and inactive. Reload before continuing.');
        return;
      }
      before.set(week, version);
    }
    const operationId = ++mutationRef.current;
    const contextGeneration = contextRef.current.generation;
    const current = () => operationId === mutationRef.current &&
      contextRef.current.generation === contextGeneration && contextRef.current.week === weekStartDate;
    busyRef.current = true; setBusy(true); setError(null); setStaleMessage(null); setSuccess(null);
    try {
      const response = await fetch('/api/staff/attendance-bulk-lock', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week_start_dates: weeks, reason: reason.trim() }),
      });
      const parsed = await body(response);
      if (!current()) return;
      if (!response.ok) {
        if (response.status === 409) {
          setStaleMessage(LOCK_STALE_MESSAGE);
          const states = await getWeekStates(weeks);
          if (!current()) return;
          const nextLocks = states.flatMap((state) => state.lock ? [state.lock] : []);
          setLocks(nextLocks);
          setReadiness(states.find((state) => state.readiness.weekStartDate === weekStartDate)?.readiness ?? readiness);
          setBulkWeeks(states.map((state) => ({
            weekStartDate: state.readiness.weekStartDate, readiness: state.readiness, loading: false, error: null,
          })));
          setLastCheckedAt(new Date().toISOString());
          return;
        }
        throw new Error(message(parsed, `HTTP ${response.status}`));
      }
      const persisted = (parsed as { success: true; data: {
        weeks: string[]; locks_created: number;
      } }).data;
      if (persisted.locks_created !== weeks.length || persisted.weeks.length !== weeks.length ||
        !weeks.every((week) => persisted.weeks.includes(week))) {
        throw new Error('Bulk lock response could not be correlated to every selected week. Reload before continuing.');
      }
      const states = await getWeekStates(weeks);
      if (!current()) return;
      const nextLocks = states.flatMap((state) => state.lock ? [state.lock] : []);
      if (!confirmsBulkLocks(weeks, before, nextLocks, reason.trim())) {
        throw new Error('Bulk lock was saved, but its active versions could not be correlated. Reload before continuing.');
      }
      setLocks(nextLocks);
      setReadiness(states.find((state) => state.readiness.weekStartDate === weekStartDate)?.readiness ?? readiness);
      setBulkWeeks(states.map((state) => ({ weekStartDate: state.readiness.weekStartDate,
        readiness: state.readiness, loading: false, error: null })));
      setLastCheckedAt(new Date().toISOString());
      setSuccess('Bulk lock saved atomically and confirmed from server readback.');
    } catch (caught) {
      if (!current()) return;
      const nextError = caught instanceof Error ? caught.message : String(caught);
      setError(nextError); log.error('[attendance-readiness] bulk command failed', { weeks, error: nextError });
    } finally {
      if (current()) { busyRef.current = false; setBusy(false); }
    }
  }, [bulkWeeks, locks, readiness, weekStartDate]);

  return {
    readiness, lock: locks.find((row) => row.week_start_date === weekStartDate) ?? null,
    locks, bulkWeeks, loading, busy, error, staleMessage, success, lastCheckedAt,
    reload: load, lockWeek: (reason: string) => submit('lock', reason),
    unlockWeek: (reason: string) => submit('unlock', reason), bulkLock, addBulkWeek,
    removeBulkWeek: (week: string) => setBulkWeeks((current) => current.filter((item) => item.weekStartDate !== week)),
  };
}
