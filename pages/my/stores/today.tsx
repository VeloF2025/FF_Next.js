/**
 * /my/stores/today — per-technician reconciliation for today.
 *
 * Shows the stores user "of the people I issued stock to today, how
 * many of those serials are installed, returned, and unaccounted for?"
 * Polls every 60s while the tab is focused so numbers refresh as the
 * day progresses without a manual reload.
 *
 * Role-gated to STORES_ROLES via useStoresSession (same pattern as
 * pages/my/stores/index.tsx). Renders are delegated to <StoresTodayList>
 * to keep this file under the 200-line component limit.
 */

import React, { useEffect, useState, useCallback } from 'react';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { Loader2, AlertCircle, ChevronLeft, RefreshCw } from 'lucide-react';

import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { useStoresSession } from '@/modules/field-stock-pwa/hooks/useStoresSession';
import { StoresTodayList } from '@/modules/field-stock-pwa/components/StoresTodayList';
import type { StoresTodayResponse } from '@/types/field-stock-pwa/storesToday';

const POLL_INTERVAL_MS = 60_000;

interface ApiEnvelope {
  success: boolean;
  data?: StoresTodayResponse;
  error?: { message?: string };
}

const StoresTodayPage: NextPage & {
  getLayout?: (page: React.ReactElement) => React.ReactElement;
} = () => {
  const router = useRouter();
  const { state, profile, error: sessionError } = useStoresSession();

  const [data, setData] = useState<StoresTodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastFetchAt, setLastFetchAt] = useState<Date | null>(null);

  // mountedRef guards every setState in fetchToday — without it the
  // `finally { setLoading(false) }` runs after an AbortError on unmount and
  // triggers React's "setState on unmounted component" dev warning.
  const mountedRef = React.useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchToday = useCallback(async (signal?: AbortSignal) => {
    if (mountedRef.current) {
      setLoading(true);
      setFetchError(null);
    }
    try {
      const res = await fetch('/api/my/stores/today', {
        credentials: 'include',
        signal,
      });
      const json = (await res.json()) as ApiEnvelope;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      }
      if (!mountedRef.current) return;
      setData(json.data);
      setLastFetchAt(new Date());
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      if (mountedRef.current) setFetchError((err as Error).message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (state !== 'authorised') return;
    const ctl = new AbortController();
    void fetchToday(ctl.signal);
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchToday();
    }, POLL_INTERVAL_MS);
    return () => {
      ctl.abort();
      window.clearInterval(id);
    };
  }, [state, fetchToday]);

  if (state === 'loading') {
    return (
      <MyPortalShell title="Today" showFooterNav={false}>
        <div className="flex items-center justify-center pt-24 gap-2 text-sm text-neutral-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      </MyPortalShell>
    );
  }

  if (state === 'guest') {
    if (typeof window !== 'undefined') void router.replace('/my');
    return (
      <MyPortalShell title="Today" showFooterNav={false}>
        <div className="flex items-center justify-center pt-24 text-sm text-neutral-400">Redirecting…</div>
      </MyPortalShell>
    );
  }

  if (state === 'unauthorised' || !profile) {
    return (
      <MyPortalShell title="Today" staffName={profile?.name} showFooterNav={false}>
        <div className="flex flex-col items-center gap-4 pt-16 text-center">
          <AlertCircle className="w-12 h-12 text-neutral-600" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-neutral-200">Not authorised</h1>
          <button
            type="button"
            onClick={() => void router.push('/my')}
            className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300"
          >
            <ChevronLeft className="w-4 h-4" /> Back to hub
          </button>
        </div>
      </MyPortalShell>
    );
  }

  if (state === 'error') {
    return (
      <MyPortalShell title="Today" showFooterNav={false}>
        <div className="flex items-start gap-2 rounded-lg bg-red-950/50 border border-red-800 px-3 py-3 text-sm text-red-200 mt-4">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{sessionError ?? 'Session check failed'}</span>
        </div>
      </MyPortalShell>
    );
  }

  return (
    <MyPortalShell title="Today" staffName={profile.name} showFooterNav={false}>
      <header className="flex items-center justify-between gap-2 pt-2 pb-3 text-xs text-neutral-400">
        <button
          type="button"
          onClick={() => void router.push('/my/stores')}
          className="inline-flex items-center gap-1 hover:text-neutral-200"
        >
          <ChevronLeft className="w-3 h-3" /> Stores
        </button>
        <button
          type="button"
          onClick={() => void fetchToday()}
          disabled={loading}
          className="inline-flex items-center gap-1 hover:text-neutral-200 disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          {lastFetchAt ? lastFetchAt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—'}
        </button>
      </header>

      {fetchError && (
        <div className="flex items-start gap-2 rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-xs text-red-200 mb-3">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{fetchError}</span>
        </div>
      )}

      {data && <StoresTodayList rows={data.rows} />}
    </MyPortalShell>
  );
};

StoresTodayPage.getLayout = (page: React.ReactElement) => page;

export default StoresTodayPage;
