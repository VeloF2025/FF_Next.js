/**
 * useOltState — shared state hook for OLT Report group
 *
 * Holds state and fetch/action functions used by 2+ OLT tabs.
 * Tab-specific state stays local in each tab component.
 */

'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { usePermission } from '@/hooks/usePermission';
import {
  Upload,
  Wrench,
  Search,
  AlertTriangle,
  History,
  BarChart3,
} from 'lucide-react';
import type {
  OltTabId,
  OltRecord,
  OltStats,
  AutoDetectStatus,
  InvestigationContext,
  DateFilter,
  ImportRecord,
} from '../types';
import { getDateRange } from '../types';

// Tab configuration with permission keys
const TABS: { id: OltTabId; label: string; icon: React.ElementType; permissionKey: string }[] = [
  { id: 'import', label: 'Import', icon: Upload, permissionKey: 'system.data-sync.olt.import' },
  { id: 'pending', label: 'Fixable', icon: Wrench, permissionKey: 'system.data-sync.olt.pending' },
  { id: 'investigate', label: 'Investigate', icon: Search, permissionKey: 'system.data-sync.olt.investigate' },
  { id: 'escalations', label: 'Escalations', icon: AlertTriangle, permissionKey: 'system.data-sync.olt.escalations' },
  { id: 'history', label: 'Fix Log', icon: History, permissionKey: 'system.data-sync.olt.history' },
  { id: 'reporting', label: 'Reporting', icon: BarChart3, permissionKey: 'system.data-sync.olt.reporting' },
];

export { TABS as OLT_TABS };

export interface UseOltStateReturn {
  // Permissions / tabs
  permissionsLoading: boolean;
  accessibleTabs: typeof TABS;
  currentTab: OltTabId;

  // Shared data
  isLoading: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  records: OltRecord[];
  page: number;
  setPage: (p: number | ((prev: number) => number)) => void;
  total: number;
  pageSize: number;
  stats: OltStats;
  imports: ImportRecord[];
  fixHistory: OltRecord[];

  // Fix state (used by Fixable + Investigate)
  fixing: string | null;
  fixErrors: Record<string, string>;
  setFixErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;

  // Date/status filters (used by Fix Log + Reporting)
  dateFilter: DateFilter;
  setDateFilter: (f: DateFilter) => void;
  customDate: string;
  setCustomDate: (d: string) => void;
  statusFilter: string;
  setStatusFilter: (s: string) => void;

  // Auto-detect (used by Import + banner on all tabs)
  autoDetectStatus: AutoDetectStatus | null;

  // Fetch functions
  fetchStats: () => Promise<void>;
  fetchRecords: (status: string, subStatus?: string, search?: string) => Promise<void>;
  fetchImports: () => Promise<void>;
  fetchAutoDetectStatus: () => Promise<void>;

  // Helpers
  getInvestigationContext: (record: OltRecord) => InvestigationContext | null;
  isStatusMismatch: (record: OltRecord) => boolean;
  handleFix: (record: OltRecord) => Promise<void>;
}

export function useOltState(
  activeTab: string | null,
  onTabChange: (tabId: string) => void
): UseOltStateReturn {
  const { can, isLoading: permissionsLoading } = usePermission();

  // Filter tabs based on permissions
  const accessibleTabs = useMemo(() => {
    if (permissionsLoading) return [];
    return TABS.filter(tab => can(tab.permissionKey, 'view'));
  }, [permissionsLoading, can]);

  // Default to first accessible tab if current tab not accessible
  const currentTab = useMemo(() => {
    const requested = activeTab as OltTabId;
    if (accessibleTabs.some(t => t.id === requested)) {
      return requested;
    }
    return accessibleTabs[0]?.id || 'pending';
  }, [activeTab, accessibleTabs]);

  // Core data state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<OltRecord[]>([]);
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [fixHistory, setFixHistory] = useState<OltRecord[]>([]);
  const [stats, setStats] = useState<OltStats>({
    pending: 0,
    needs_investigation: 0,
    fixed: 0,
    resolved: 0,
    escalated: 0,
    empty: 0,
    total: 0,
  });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 50;

  // Fix state (shared between Fixable + Investigate)
  const [fixing, setFixing] = useState<string | null>(null);
  const [fixErrors, setFixErrors] = useState<Record<string, string>>({});

  // Date/status filters (shared between Fix Log + Reporting)
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customDate, setCustomDate] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Auto-detect status (shared across all tabs)
  const [autoDetectStatus, setAutoDetectStatus] = useState<AutoDetectStatus | null>(null);

  // Sync URL with active tab on mount
  useEffect(() => {
    if (!activeTab) {
      onTabChange('pending');
    }
  }, [activeTab, onTabChange]);

  // ─── Fetch functions ────────────────────────────────────────────────

  const fetchStats = useCallback(async () => {
    try {
      const range = getDateRange(dateFilter, customDate);
      const params = new URLSearchParams();
      if (range.dateFrom) params.set('dateFrom', range.dateFrom);
      if (range.dateTo) params.set('dateTo', range.dateTo);
      const qs = params.toString();
      const res = await fetch(`/api/system/olt-report/stats${qs ? `?${qs}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        setStats(data.data || data);
      }
    } catch {
      // Silently fail
    }
  }, [dateFilter, customDate]);

  const fetchRecords = useCallback(
    async (status: string, subStatus?: string, search?: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ status, page: String(page), pageSize: String(pageSize) });
        if (subStatus && subStatus !== 'all') params.set('subStatus', subStatus);
        if (search) params.set('search', search);
        const res = await fetch(`/api/system/olt-report/records?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setRecords(data.data?.records || data.records || []);
          setTotal(data.data?.total || data.total || 0);
        } else {
          setError('Failed to fetch records');
        }
      } catch {
        setError('Failed to fetch records');
      } finally {
        setIsLoading(false);
      }
    },
    [page]
  );

  const fetchImports = useCallback(async () => {
    setIsLoading(true);
    try {
      const range = getDateRange(dateFilter, customDate);
      const dateParams = new URLSearchParams();
      if (range.dateFrom) dateParams.set('dateFrom', range.dateFrom);
      if (range.dateTo) dateParams.set('dateTo', range.dateTo);
      const dateQs = dateParams.toString();
      const apiStatus = statusFilter === 'all' ? 'all' : statusFilter;
      const fixUrl = `/api/system/olt-report/records?status=${apiStatus}&page=1&pageSize=200${dateQs ? `&${dateQs}` : ''}`;

      const [importsRes, fixesRes] = await Promise.all([
        fetch('/api/system/olt-report/imports'),
        fetch(fixUrl),
      ]);
      if (importsRes.ok) {
        const data = await importsRes.json();
        setImports(data.data?.imports || data.imports || []);
      }
      if (fixesRes.ok) {
        const data = await fixesRes.json();
        const fixedRecords = data.data?.records || data.records || [];
        setFixHistory(fixedRecords);
        setTotal(data.data?.total || data.total || 0);
      }
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false);
    }
  }, [dateFilter, customDate, statusFilter]);

  const fetchAutoDetectStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/system/olt-report/auto-detect-status');
      if (res.ok) {
        const data = await res.json();
        setAutoDetectStatus(data.data || data);
      }
    } catch {
      // Silently fail
    }
  }, []);

  // ─── Auto-detect polling ───────────────────────────────────────────

  const prevRunStatusRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    fetchAutoDetectStatus();
    const isRunning = autoDetectStatus?.run?.status === 'running' || autoDetectStatus?.run?.status === 'processing_queue';
    if (!isRunning) return;
    const pollInterval = currentTab === 'import' ? 5000 : 15000;
    const interval = setInterval(fetchAutoDetectStatus, pollInterval);
    return () => clearInterval(interval);
  }, [currentTab, autoDetectStatus?.run?.status, fetchAutoDetectStatus]);

  // Toast when auto-detect completes
  useEffect(() => {
    const currentStatus = autoDetectStatus?.run?.status;
    const prevStatus = prevRunStatusRef.current;
    prevRunStatusRef.current = currentStatus;

    if (!prevStatus || !currentStatus) return;

    const wasRunning = prevStatus === 'running' || prevStatus === 'processing_queue';
    if (wasRunning && currentStatus === 'completed') {
      const run = autoDetectStatus?.run;
      toast.success(
        `OLT Auto-Detect Complete: ${run?.matches || 0} matches, ${run?.mismatchesNote4 || 0} mismatches found from ${run?.totalOesRows || 0} OES rows`,
        { duration: 8000 }
      );
      fetchStats();
    } else if (wasRunning && currentStatus === 'error') {
      toast.error('OLT Auto-Detect failed. Check the status card for details.', { duration: 8000 });
    }
  }, [autoDetectStatus?.run?.status, autoDetectStatus?.run, autoDetectStatus?.queue, fetchStats]);

  // ─── Tab-change data loading ───────────────────────────────────────

  useEffect(() => {
    // Clear stale fix state on tab change
    setFixErrors({});

    fetchStats();
    if (currentTab === 'pending') {
      fetchRecords('pending');
    } else if (currentTab === 'investigate') {
      fetchRecords('needs_investigation');
    } else if (currentTab === 'escalations') {
      fetchRecords('escalated');
    } else if (currentTab === 'history') {
      fetchImports();
    }
    // reporting tab fetches its own data locally
  }, [currentTab, page, fetchStats, fetchRecords, fetchImports]);

  // ─── Helpers ───────────────────────────────────────────────────────

  const getInvestigationContext = useCallback((record: OltRecord): InvestigationContext | null => {
    if (!record.investigation_context) return null;
    try {
      return typeof record.investigation_context === 'string'
        ? JSON.parse(record.investigation_context)
        : record.investigation_context;
    } catch { return null; }
  }, []);

  const isStatusMismatch = useCallback((record: OltRecord): boolean => {
    const ctx = getInvestigationContext(record);
    return ctx?.reason === 'status_mismatch';
  }, [getInvestigationContext]);

  const handleFix = useCallback(async (record: OltRecord) => {
    if (!record.olt_serial) return;

    setFixing(record.id);
    setFixErrors(prev => { const n = { ...prev }; delete n[record.id]; return n; });

    try {
      const ctx = getInvestigationContext(record);
      const isStatusFix = ctx?.reason === 'status_mismatch' && ctx?.propId;

      const endpoint = isStatusFix
        ? '/api/system/olt-report/fix-status'
        : '/api/system/olt-report/fix-1map';

      const body = isStatusFix
        ? { propId: ctx.propId, drNumber: record.drop_number }
        : { drNumber: record.drop_number, correctSerial: record.olt_serial, wrongSerial: record.wrong_onemap_serial };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      const result = data.data || data;

      if (result.success) {
        fetchRecords('pending');
        fetchStats();
      } else {
        const errorMsg = result.error || 'Fix failed';
        setFixErrors(prev => ({ ...prev, [record.id]: errorMsg }));
        if (errorMsg.includes('not found') || errorMsg.includes('Not found')) {
          fetchRecords('pending');
          fetchStats();
        }
      }
    } catch {
      setFixErrors(prev => ({ ...prev, [record.id]: 'Network error - try again' }));
    } finally {
      setFixing(null);
    }
  }, [getInvestigationContext, fetchRecords, fetchStats]);

  return {
    permissionsLoading,
    accessibleTabs,
    currentTab,

    isLoading,
    error,
    setError,
    records,
    page,
    setPage,
    total,
    pageSize,
    stats,
    imports,
    fixHistory,

    fixing,
    fixErrors,
    setFixErrors,

    dateFilter,
    setDateFilter,
    customDate,
    setCustomDate,
    statusFilter,
    setStatusFilter,

    autoDetectStatus,

    fetchStats,
    fetchRecords,
    fetchImports,
    fetchAutoDetectStatus,

    getInvestigationContext,
    isStatusMismatch,
    handleFix,
  };
}
