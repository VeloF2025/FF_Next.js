/**
 * useReconLedger — state + fetch for the per-DR three-way reconciliation ledger
 * (audit rec #3). Backed by GET /api/system/olt-report/ledger
 * (v_dr_reconciliation_ledger, migration 414). Self-contained: does not share the
 * olt_mismatch_records fetch logic in useOltState.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReconClass, ReconLedgerRow } from '../types';
import { log } from '@/lib/logger';

const PAGE_SIZE = 50;

export interface ReconSummary {
  recon_class: ReconClass;
  count: number;
}

export interface UseReconLedger {
  records: ReconLedgerRow[];
  summary: ReconSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isLoading: boolean;
  error: string | null;
  reconClass: ReconClass | null;
  search: string;
  setReconClass: (c: ReconClass | null) => void;
  setSearch: (s: string) => void;
  setPage: (p: number | ((prev: number) => number)) => void;
  refresh: () => void;
}

export function useReconLedger(): UseReconLedger {
  const [records, setRecords] = useState<ReconLedgerRow[]>([]);
  const [summary, setSummary] = useState<ReconSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconClass, setReconClassState] = useState<ReconClass | null>(null);
  const [search, setSearchState] = useState('');
  // Bump to force a refetch without changing filters.
  const [nonce, setNonce] = useState(0);

  // Reset to page 1 whenever a filter changes (avoids landing on an empty page).
  const setReconClass = useCallback((c: ReconClass | null) => {
    setReconClassState(c);
    setPage(1);
  }, []);
  const setSearch = useCallback((s: string) => {
    setSearchState(s);
    setPage(1);
  }, []);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('pageSize', String(PAGE_SIZE));
        params.set('summary', '1');
        if (reconClass) params.set('recon_class', reconClass);
        if (search.trim()) params.set('search', search.trim());

        const res = await fetch(`/api/system/olt-report/ledger?${params.toString()}`);
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = await res.json();
        const data = json.data || json;
        if (cancelled) return;
        setRecords(data.records || []);
        setTotal(data.total || 0);
        if (data.summary) setSummary(data.summary);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        log.error('useReconLedger', { error: message });
        setError(message);
        setRecords([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [page, reconClass, search, nonce]);

  return {
    records,
    summary,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    isLoading,
    error,
    reconClass,
    search,
    setReconClass,
    setSearch,
    setPage,
    refresh,
  };
}
