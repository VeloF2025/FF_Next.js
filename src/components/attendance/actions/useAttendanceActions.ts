import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { log } from '@/lib/logger';
import type {
  ApprovedHours, DayExceptionDecisionResult, DayExceptionItem, DayExceptionKind,
  DayExceptionListResult, DayExceptionStatusFilter,
} from '@/modules/attendance/workflow/types';
import { DAY_EXCEPTION_KINDS, DAY_EXCEPTION_STATUSES } from '@/modules/attendance/workflow/types';
import type { AttendanceDecisionDraft } from './DecisionForm';

export const STALE_STATE_MESSAGE = 'This attendance action changed since you opened it. Your decision was not saved. Review the refreshed details and try again.';
const STATUS_VALUES = new Set<string>(['unresolved', 'all', ...DAY_EXCEPTION_STATUSES]);
const KIND_VALUES = new Set<string>(DAY_EXCEPTION_KINDS);

function queryValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function errorMessage(body: unknown, fallback: string): string {
  const error = (body as { error?: { message?: string; details?: { reason?: string } } } | null)?.error;
  return error?.message ?? fallback;
}

async function responseBody(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

const HOUR_KEYS: readonly (keyof ApprovedHours)[] = [
  'regular', 'overtime', 'sunday', 'holiday', 'leave', 'unpaid',
];

function sameHours(left: ApprovedHours | null, right: ApprovedHours | null): boolean {
  return left === right || Boolean(left && right && HOUR_KEYS.every((key) => left[key] === right[key]));
}

function confirmsDecision(item: DayExceptionItem, persisted: DayExceptionDecisionResult): boolean {
  return item.id === persisted.exception.id
    && item.status === persisted.exception.status
    && item.resultVersion === persisted.exception.resultVersion
    && item.resultVersion === persisted.dailyResult.resultVersion
    && item.dailyResult.status === persisted.dailyResult.status
    && item.dailyResult.attendanceClassification === persisted.dailyResult.attendanceClassification
    && sameHours(item.dailyResult.approvedHours, persisted.dailyResult.approvedHours);
}

export function useAttendanceActions() {
  const router = useRouter();
  const rawStatus = queryValue(router.query.status);
  const rawKind = queryValue(router.query.kind);
  const requestedExceptionId = queryValue(router.query.exception_id);
  const status = (rawStatus && STATUS_VALUES.has(rawStatus) ? rawStatus : 'unresolved') as DayExceptionStatusFilter;
  const kind = rawKind && KIND_VALUES.has(rawKind) ? rawKind as DayExceptionKind : undefined;
  const [data, setData] = useState<DayExceptionListResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exactItem, setExactItem] = useState<DayExceptionItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleMessage, setStaleMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const busyRef = useRef(false);

  const load = useCallback(async (options: { silent?: boolean; preferId?: string } = {}): Promise<DayExceptionListResult | null> => {
    if (!options.silent) setLoading(true);
    setError(null);
    const params = new URLSearchParams({ status, limit: '50' });
    if (kind) params.set('kind', kind);
    try {
      const response = await fetch(`/api/staff/attendance-day-exceptions?${params}`, { credentials: 'same-origin' });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(errorMessage(body, `HTTP ${response.status}`));
      const next = (body as { success: true; data: DayExceptionListResult }).data;
      setData(next);
      setExactItem(null);
      setLastCheckedAt(new Date().toISOString());
      setSelectedId((current) => {
        const preferred = options.preferId ?? requestedExceptionId ?? current;
        if (requestedExceptionId && !next.items.some((item) => item.id === requestedExceptionId)) return null;
        return next.items.some((item) => item.id === preferred) ? preferred : next.items[0]?.id ?? null;
      });
      return next;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      log.error('[attendance-actions] load failed', { status, kind, error: message });
      return null;
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [kind, requestedExceptionId, status]);

  const loadExact = useCallback(async (id: string): Promise<DayExceptionItem> => {
    const response = await fetch('/api/staff/attendance-day-exceptions?status=all&limit=200', {
      credentials: 'same-origin',
    });
    const body = await responseBody(response);
    if (!response.ok) throw new Error(errorMessage(body, `HTTP ${response.status}`));
    const result = (body as { success: true; data: DayExceptionListResult }).data;
    const exact = result.items.find((candidate) => candidate.id === id);
    if (!exact) throw new Error('The exact attendance action could not be confirmed from the scoped readback. Reload before continuing.');
    setExactItem(exact);
    setLastCheckedAt(new Date().toISOString());
    return exact;
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!requestedExceptionId || !data || data.items.some((item) => item.id === requestedExceptionId)) return;
    setSelectedId(null); setExactItem(null);
    void loadExact(requestedExceptionId)
      .then(() => setSelectedId(requestedExceptionId))
      .catch((caught) => {
        setSelectedId(null); setExactItem(null);
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        log.error('[attendance-actions] deep-link readback failed', { exceptionId: requestedExceptionId, error: message });
      });
  }, [data, loadExact, requestedExceptionId]);

  const setFilters = useCallback((filters: { status: DayExceptionStatusFilter; kind?: DayExceptionKind }) => {
    const query: Record<string, string> = {};
    if (filters.status !== 'unresolved') query.status = filters.status;
    if (filters.kind) query.kind = filters.kind;
    if (requestedExceptionId) query.exception_id = requestedExceptionId;
    void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  }, [requestedExceptionId, router]);

  const submit = useCallback(async (item: DayExceptionItem, draft: AttendanceDecisionDraft) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setStaleMessage(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/staff/attendance-day-exceptions-review', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exception_id: item.id, expected_result_version: item.resultVersion,
          action: draft.action, reason: draft.reason,
          approved_hours: draft.approvedHours, classification: draft.classification,
        }),
      });
      const body = await responseBody(response);
      if (!response.ok) {
        const message = errorMessage(body, `HTTP ${response.status}`);
        if (response.status === 409) {
          setStaleMessage(STALE_STATE_MESSAGE);
          await loadExact(item.id);
          return;
        }
        throw new Error(message);
      }
      const persisted = (body as { success: true; data: DayExceptionDecisionResult }).data;
      const exact = await loadExact(item.id);
      if (!confirmsDecision(exact, persisted)) {
        setError('Decision was saved, but the exact attendance action readback did not match the persisted decision. Reload before continuing.');
        return;
      }
      const refreshed = await load({ silent: true });
      if (!refreshed) return;
      setSuccess('Decision saved and confirmed from the refreshed queue.');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      log.error('[attendance-actions] decision failed', { exceptionId: item.id, action: draft.action, error: message });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [load, loadExact]);

  const select = useCallback((id: string) => {
    setExactItem(null);
    setSelectedId(id);
  }, []);

  const selected = requestedExceptionId
    ? exactItem?.id === requestedExceptionId ? exactItem
      : data?.items.find((item) => item.id === requestedExceptionId) ?? null
    : exactItem?.id === selectedId ? exactItem : data?.items.find((item) => item.id === selectedId) ?? null;

  return {
    data, selectedId, selected,
    status, kind, loading, busy, error, staleMessage, success, lastCheckedAt,
    setSelectedId: select, setFilters, submit, reload: load,
  };
}
