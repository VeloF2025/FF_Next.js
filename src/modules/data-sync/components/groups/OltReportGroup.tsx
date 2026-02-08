/**
 * OLT Report Group Component
 * Wraps OLT report tabs: Import, Pending, Investigate, Escalations, History, Reporting
 *
 * Note: This component embeds the full OLT report functionality inline since the
 * original page (1785 lines) has complex state management that's tightly coupled.
 * A future refactor could extract these into separate components.
 */

'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  Upload,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileSpreadsheet,
  RefreshCw,
  ExternalLink,
  Wrench,
  History,
  XCircle,
  Search,
  BarChart3,
  Download,
  Calendar,
  Loader2,
  CheckSquare,
  Square,
  Lock,
  Zap,
  Database,
  ChevronDown,
  ChevronRight,
  ArrowLeftRight,
} from 'lucide-react';
import type { OltTabId } from '../../types';
import { usePermission } from '@/hooks/usePermission';

// Tab configuration with permission keys
const TABS: { id: OltTabId; label: string; icon: React.ElementType; permissionKey: string }[] = [
  { id: 'import', label: 'Import', icon: Upload, permissionKey: 'system.data-sync.olt.import' },
  { id: 'pending', label: 'Fixable', icon: Wrench, permissionKey: 'system.data-sync.olt.pending' },
  { id: 'investigate', label: 'Investigate', icon: Search, permissionKey: 'system.data-sync.olt.investigate' },
  { id: 'escalations', label: 'Escalations', icon: AlertTriangle, permissionKey: 'system.data-sync.olt.escalations' },
  { id: 'history', label: 'History', icon: History, permissionKey: 'system.data-sync.olt.history' },
  { id: 'reporting', label: 'Reporting', icon: BarChart3, permissionKey: 'system.data-sync.olt.reporting' },
];

type ReportPeriod = 'today' | 'yesterday' | 'week' | '30days' | 'all';
type DateFilter = 'today' | 'yesterday' | '7d' | '30d' | 'all' | 'custom';

function getDateRange(filter: DateFilter, customDate?: string): { dateFrom?: string; dateTo?: string } {
  if (filter === 'all') return {};
  const now = new Date();
  if (filter === 'custom' && customDate) {
    const d = new Date(customDate);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    return { dateFrom: d.toISOString(), dateTo: next.toISOString() };
  }
  if (filter === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { dateFrom: start.toISOString() };
  }
  if (filter === 'yesterday') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
  }
  if (filter === '7d') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    return { dateFrom: start.toISOString() };
  }
  if (filter === '30d') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
    return { dateFrom: start.toISOString() };
  }
  return {};
}

interface OltRecord {
  id: string;
  drop_number: string;
  zone?: string | null;
  address?: string | null;
  olt_serial: string | null;
  onemap_serial?: string | null;
  wrong_onemap_serial?: string | null;
  onemap_prop_id?: string | null;
  offline_serial?: string | null;
  oes_serial?: string | null;
  onemap_fix_attempted?: boolean;
  onemap_fix_result?: string | null;
  onemap_fix_old_value?: string | null;
  onemap_fix_at?: string | null;
  fix_status?: string;
  fix_attempted_at?: string | null;
  created_at?: string | null;
  fix_result?: string | null;
  fix_old_value?: string | null;
  investigation_context?: string | null;
  has_ups_swap?: boolean;
  detection_source?: string;
  status?: string;
  comparison_status?: string;
  row_index?: number;
  import_filename?: string;
  import_date?: string;
  project?: string;
}

interface InvestigationContext {
  reason: string;
  wrongSerial: string;
  wrongUps?: string | null;
  belongsToDr: string;
  belongsToTeam: string;
  belongsToStatus: string;
  totalPropRecords: number;
  correctRecords: number;
  wrongRecords: number;
  swappedRecords: number;
  message: string;
}

interface SwapLookupResult {
  drA: { drNumber: string; oesSerial: string; oneMapSerial: string; oneMapUps: string | null };
  drB: { drNumber: string; oesSerial: string | null; oneMapSerial: string | null; oneMapUps: string | null; foundOn1Map: boolean };
  upsTransfer: { needed: boolean; serial: string | null; from: string; to: string } | null;
  scenario: 'clean_swap' | 'fix_a_only' | 'fix_a_flag_b' | 'fix_a_b_missing';
  recommendation: string;
  canAutoSwap: boolean;
}

interface ImportRecord {
  id: string;
  filename: string;
  project: string | null;
  total_records: number;
  match_count: number;
  mismatch_count: number;
  empty_serial_count: number;
  not_found_count: number;
  imported_at: string;
  imported_by_email: string | null;
}

interface Stats {
  pending: number;
  needs_investigation: number;
  fixed: number;
  resolved: number;
  escalated: number;
  empty: number;
  total: number;
}

interface OltReportGroupProps {
  activeTab: string | null;
  onTabChange: (tabId: string) => void;
}

export function OltReportGroup({ activeTab, onTabChange }: OltReportGroupProps) {
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

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Import state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [project, setProject] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    success: boolean;
    stats: {
      totalRecords: number;
      matchCount: number;
      mismatchCount: number;
      emptySerialCount: number;
      updatedCount: number;
    };
  } | null>(null);

  // Data state
  const [records, setRecords] = useState<OltRecord[]>([]);
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [fixHistory, setFixHistory] = useState<OltRecord[]>([]);
  const [stats, setStats] = useState<Stats>({
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

  // Fix state
  const [fixing, setFixing] = useState<string | null>(null);
  const [fixErrors, setFixErrors] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkFixing, setBulkFixing] = useState(false);
  const [bulkFixResult, setBulkFixResult] = useState<{
    total: number;
    successCount: number;
    failCount: number;
  } | null>(null);

  // Track expanded investigation context cards
  const [expandedContexts, setExpandedContexts] = useState<Set<string>>(new Set());
  const toggleContext = (id: string) => {
    setExpandedContexts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Cross-DR swap state
  const [swapLookups, setSwapLookups] = useState<Record<string, SwapLookupResult>>({});
  const [swapLoading, setSwapLoading] = useState<Set<string>>(new Set());
  const [swapErrors, setSwapErrors] = useState<Record<string, string>>({});

  // Projects state
  const [projects, setProjects] = useState<
    Array<{ id: string; project_name: string; project_code: string }>
  >([]);

  // Resolve/Escalate state
  const [showResolveModal, setShowResolveModal] = useState<string | null>(null);
  const [showEscalateModal, setShowEscalateModal] = useState<string | null>(null);
  const [resolutionType, setResolutionType] = useState<string>('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [escalateTo, setEscalateTo] = useState('');
  const [escalateNotes, setEscalateNotes] = useState('');
  const [adminUsers, setAdminUsers] = useState<Array<{ id: string; email: string; name: string }>>([]);
  const [resolving, setResolving] = useState(false);
  const [escalating, setEscalating] = useState(false);

  // Reporting state
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('all');
  const [reportStatusFilter, setReportStatusFilter] = useState<string>('all');
  const [reportData, setReportData] = useState<{
    summary: {
      total: number;
      fixed: number;
      pending: number;
      empty_serial: number;
      not_found: number;
    };
    records: OltRecord[];
    fixesByDay: Array<{ date: string; count: number }>;
    imports: Array<{
      id: string;
      filename: string;
      project: string;
      mismatch_count: number;
      fixed_count: number;
      pending_count: number;
      imported_at: string;
    }>;
  } | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Date filter state for stats cards and history
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customDate, setCustomDate] = useState<string>('');
  // Status filter — 'all' shows everything, otherwise filters by fix_status category
  const [statusFilter, setStatusFilter] = useState<string>('all');
  // Sub-status filter for Investigate tab (filter within needs_investigation records)
  const [investigateSubFilter, setInvestigateSubFilter] = useState<string>('all');

  // Auto-detect status state
  const [autoDetectStatus, setAutoDetectStatus] = useState<{
    hasRun: boolean;
    run?: {
      id: number;
      totalOesRows: number;
      cacheHits: number;
      cacheMisses: number;
      matches: number;
      mismatchesNote2: number;
      mismatchesNote4: number;
      upsSwaps: number;
      duplicatesSkipped: number;
      apiLookupsQueued: number;
      status: string;
      startedAt: string;
      completedAt: string | null;
    };
    queue?: {
      pending: number;
      completed: number;
      errors: number;
      total: number;
    };
  } | null>(null);

  // Sync URL with active tab on mount
  useEffect(() => {
    if (!activeTab) {
      onTabChange('pending');
    }
  }, [activeTab, onTabChange]);

  // Fetch projects and admin users on mount
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const res = await fetch('/api/projects?status=active&limit=100');
        if (res.ok) {
          const data = await res.json();
          setProjects(data.data?.projects || data.projects || []);
        }
      } catch {
        // Silently fail
      }
    };
    const fetchAdminUsers = async () => {
      try {
        const res = await fetch('/api/system/olt-report/admin-users');
        if (res.ok) {
          const data = await res.json();
          setAdminUsers(data.data || data || []);
        }
      } catch {
        // Silently fail
      }
    };
    fetchProjects();
    fetchAdminUsers();
  }, []);

  // Fetch stats (with optional date filter)
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

  // Fetch records based on tab
  const fetchRecords = useCallback(
    async (status: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/system/olt-report/records?status=${status}&page=${page}&pageSize=${pageSize}`
        );
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

  // Fetch imports history + recent fixes (with date + status filter)
  const fetchImports = useCallback(async () => {
    setIsLoading(true);
    try {
      const range = getDateRange(dateFilter, customDate);
      const dateParams = new URLSearchParams();
      if (range.dateFrom) dateParams.set('dateFrom', range.dateFrom);
      if (range.dateTo) dateParams.set('dateTo', range.dateTo);
      const dateQs = dateParams.toString();
      // Map statusFilter to API status param
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

  // Fetch reporting data
  const fetchReportData = useCallback(async () => {
    setReportLoading(true);
    try {
      const res = await fetch(`/api/system/olt-report/reporting?period=${reportPeriod}`);
      if (res.ok) {
        const data = await res.json();
        setReportData(data.data || data);
      }
    } catch {
      // Silently fail
    } finally {
      setReportLoading(false);
    }
  }, [reportPeriod]);

  // Export CSV
  const handleExportCSV = async () => {
    setExporting(true);
    try {
      const res = await fetch(
        `/api/system/olt-report/reporting?period=${reportPeriod}&status=${reportStatusFilter}&format=csv`
      );
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        // Build descriptive filename matching the current filter
        const statusLabel = reportStatusFilter === 'all' ? 'all-records' : reportStatusFilter.replace(/_/g, '-');
        a.download = `olt-report-${statusLabel}-${reportPeriod}-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        setError('Export failed');
      }
    } catch {
      setError('Export failed');
    } finally {
      setExporting(false);
    }
  };

  // Fetch auto-detect status
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

  // Track previous run status for toast notification
  const prevRunStatusRef = useRef<string | undefined>(undefined);

  // Poll auto-detect status - poll more frequently on import tab, background poll on other tabs
  useEffect(() => {
    fetchAutoDetectStatus();
    const isRunning = autoDetectStatus?.run?.status === 'running' || autoDetectStatus?.run?.status === 'processing_queue';
    if (!isRunning) return;
    const pollInterval = currentTab === 'import' ? 5000 : 15000;
    const interval = setInterval(fetchAutoDetectStatus, pollInterval);
    return () => clearInterval(interval);
  }, [currentTab, autoDetectStatus?.run?.status, fetchAutoDetectStatus]);

  // Show toast when auto-detect run completes
  useEffect(() => {
    const currentStatus = autoDetectStatus?.run?.status;
    const prevStatus = prevRunStatusRef.current;
    prevRunStatusRef.current = currentStatus;

    if (!prevStatus || !currentStatus) return;

    const wasRunning = prevStatus === 'running' || prevStatus === 'processing_queue';
    if (wasRunning && currentStatus === 'completed') {
      const run = autoDetectStatus?.run;
      const queue = autoDetectStatus?.queue;
      const totalMismatches = (run?.mismatchesNote4 || 0) + (queue?.completed || 0) - (run?.matches || 0);
      toast.success(
        `OLT Auto-Detect Complete: ${run?.matches || 0} matches, ${run?.mismatchesNote4 || 0} mismatches found from ${run?.totalOesRows || 0} OES rows`,
        { duration: 8000 }
      );
      // Refresh stats to reflect new mismatch records
      fetchStats();
    } else if (wasRunning && currentStatus === 'error') {
      toast.error('OLT Auto-Detect failed. Check the status card for details.', { duration: 8000 });
    }
  }, [autoDetectStatus?.run?.status, autoDetectStatus?.run, autoDetectStatus?.queue, fetchStats]);

  // Load data based on current tab
  useEffect(() => {
    // Clear stale fix state on tab change
    setBulkFixResult(null);
    setFixErrors({});
    setSelectedIds(new Set());
    setInvestigateSubFilter('all');

    fetchStats();
    if (currentTab === 'pending') {
      fetchRecords('pending');
    } else if (currentTab === 'investigate') {
      fetchRecords('needs_investigation');
    } else if (currentTab === 'escalations') {
      fetchRecords('escalated');
    } else if (currentTab === 'history') {
      fetchImports();
    } else if (currentTab === 'reporting') {
      fetchReportData();
    }
  }, [currentTab, page, fetchStats, fetchRecords, fetchImports, fetchReportData]);

  // Handle file upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setUploadResult(null);
    }
  };

  // Handle import
  const handleImport = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', selectedFile);
    if (project) formData.append('project', project);

    try {
      const res = await fetch('/api/system/olt-report/import', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      // apiResponse.success wraps as { success, data: { stats, ... } }
      const result = data.data || data;
      if (data.success) {
        setUploadResult({ success: true, stats: result.stats });
        fetchStats();
        setSelectedFile(null);
      } else {
        setError(data.error?.message || data.error || 'Import failed');
      }
    } catch {
      setError('Import failed');
    } finally {
      setIsUploading(false);
    }
  };

  // Parse investigation context to detect status mismatches
  const getInvestigationContext = (record: OltRecord) => {
    if (!record.investigation_context) return null;
    try {
      return typeof record.investigation_context === 'string'
        ? JSON.parse(record.investigation_context)
        : record.investigation_context;
    } catch { return null; }
  };

  const isStatusMismatch = (record: OltRecord) => {
    const ctx = getInvestigationContext(record);
    return ctx?.reason === 'status_mismatch';
  };

  // Handle fix
  const handleFix = async (record: OltRecord) => {
    if (!record.olt_serial) return;

    setFixing(record.id);
    // Clear any previous error for this record
    setFixErrors((prev) => { const n = { ...prev }; delete n[record.id]; return n; });

    try {
      // Route status mismatches to fix-status API
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
      // apiResponse.success() wraps as { success: true, data: { success, ... } }
      const result = data.data || data;

      if (result.success) {
        // Actual fix succeeded - refresh lists
        fetchRecords('pending');
        fetchStats();
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(record.id);
          return next;
        });
      } else {
        // Fix failed - show error on the record row
        const errorMsg = result.error || 'Fix failed';
        setFixErrors((prev) => ({ ...prev, [record.id]: errorMsg }));
        // If record moved to investigate/not_found, refresh
        if (errorMsg.includes('not found') || errorMsg.includes('Not found')) {
          fetchRecords('pending');
          fetchStats();
        }
      }
    } catch {
      setFixErrors((prev) => ({ ...prev, [record.id]: 'Network error - try again' }));
    } finally {
      setFixing(null);
    }
  };

  // Handle bulk fix - process in batches of 5 to avoid Cloudflare 524 timeout
  const handleBulkFix = async () => {
    const selectedRecords = records.filter(
      (r) => selectedIds.has(r.id) && r.olt_serial
    );
    if (selectedRecords.length === 0) return;

    setBulkFixing(true);
    setBulkFixResult(null);
    setError(null);

    // Separate status mismatches from serial mismatches
    const statusRecords = selectedRecords.filter(r => isStatusMismatch(r));
    const serialRecords = selectedRecords.filter(r => !isStatusMismatch(r));

    const BATCH_SIZE = 5;
    let totalSuccess = 0;
    let totalFail = 0;
    const allErrors: Record<string, string> = {};

    try {
      // Fix status mismatches one by one
      for (const rec of statusRecords) {
        setBulkFixResult({ total: selectedRecords.length, successCount: totalSuccess, failCount: totalFail });
        const ctx = getInvestigationContext(rec);
        try {
          const r = await fetch('/api/system/olt-report/fix-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ propId: ctx?.propId, drNumber: rec.drop_number }),
          });
          const d = await r.json();
          const result = d.data || d;
          if (result.success) totalSuccess++;
          else { totalFail++; allErrors[rec.id] = result.error || 'Status fix failed'; }
        } catch { totalFail++; allErrors[rec.id] = 'Network error'; }
      }

      // Fix serial mismatches in bulk batches
      for (let i = 0; i < serialRecords.length; i += BATCH_SIZE) {
        const batch = serialRecords.slice(i, i + BATCH_SIZE);

        // Update progress display
        setBulkFixResult({
          total: selectedRecords.length,
          successCount: totalSuccess,
          failCount: totalFail,
        });

        const res = await fetch('/api/system/olt-report/fix-1map', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bulk: true,
            items: batch.map((r) => ({
              drNumber: r.drop_number,
              correctSerial: r.olt_serial,
              wrongSerial: r.wrong_onemap_serial,
            })),
          }),
        });

        const data = await res.json();
        const result = data.data || data;

        if (result.bulk) {
          totalSuccess += result.successCount || 0;
          totalFail += result.failCount || 0;
          // Collect per-record errors
          if (result.results) {
            for (const r of result.results) {
              if (!r.success && r.error) {
                const rec = records.find((rec) => rec.drop_number === r.drNumber);
                if (rec) allErrors[rec.id] = r.error;
              }
            }
          }
        } else {
          // Entire batch failed
          totalFail += batch.length;
        }
      }

      setBulkFixResult({
        total: selectedRecords.length,
        successCount: totalSuccess,
        failCount: totalFail,
      });
      setFixErrors(allErrors);
      setSelectedIds(new Set());
      fetchRecords('pending');
      fetchStats();
    } catch {
      setError(`Bulk fix failed after ${totalSuccess} of ${selectedRecords.length} records`);
    } finally {
      setBulkFixing(false);
    }
  };

  // Handle resolve
  const handleResolve = async (recordId: string) => {
    if (!resolutionType) {
      setError('Please select a resolution type');
      return;
    }
    setResolving(true);
    try {
      const res = await fetch('/api/system/olt-report/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId,
          action: 'resolve',
          resolutionType,
          notes: resolutionNotes || undefined,
        }),
      });
      const data = await res.json();
      if (data.success || data.data?.success) {
        setShowResolveModal(null);
        setResolutionType('');
        setResolutionNotes('');
        fetchRecords('needs_investigation');
        fetchStats();
      } else {
        setError(typeof data.error === 'string' ? data.error : data.error?.message || 'Resolve failed');
      }
    } catch {
      setError('Resolve failed');
    } finally {
      setResolving(false);
    }
  };

  // Handle escalate
  const handleEscalate = async (recordId: string) => {
    if (!escalateTo) {
      setError('Please select an admin to escalate to');
      return;
    }
    setEscalating(true);
    try {
      const res = await fetch('/api/system/olt-report/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId,
          action: 'escalate',
          escalateTo,
          notes: escalateNotes || undefined,
        }),
      });
      const data = await res.json();
      if (data.success || data.data?.success) {
        setShowEscalateModal(null);
        setEscalateTo('');
        setEscalateNotes('');
        fetchRecords('needs_investigation');
        fetchStats();
      } else {
        setError(typeof data.error === 'string' ? data.error : data.error?.message || 'Escalate failed');
      }
    } catch {
      setError('Escalate failed');
    } finally {
      setEscalating(false);
    }
  };

  // Handle cross-DR lookup
  const handleSwapLookup = async (record: OltRecord) => {
    if (!record.investigation_context) return;
    let ctx: InvestigationContext;
    try { ctx = JSON.parse(record.investigation_context); } catch { return; }

    setSwapLoading(prev => new Set(prev).add(record.id));
    setSwapErrors(prev => { const n = { ...prev }; delete n[record.id]; return n; });

    try {
      const res = await fetch('/api/system/olt-report/cross-dr-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: record.id,
          drNumber: record.drop_number,
          wrongSerial: ctx.wrongSerial,
          belongsToDr: ctx.belongsToDr,
        }),
      });
      const data = await res.json();
      const result = data.data || data;
      if (result.drA) {
        setSwapLookups(prev => ({ ...prev, [record.id]: result }));
      } else {
        const errMsg = typeof result.error === 'string' ? result.error : result.error?.message || 'Lookup failed';
        setSwapErrors(prev => ({ ...prev, [record.id]: errMsg }));
      }
    } catch {
      setSwapErrors(prev => ({ ...prev, [record.id]: 'Network error' }));
    } finally {
      setSwapLoading(prev => { const n = new Set(prev); n.delete(record.id); return n; });
    }
  };

  // Handle cross-DR swap fix
  const handleSwapFix = async (record: OltRecord, lookup: SwapLookupResult, fixBothDrs: boolean) => {
    const scenario = fixBothDrs ? lookup.scenario : 'fix_a_only';

    setSwapLoading(prev => new Set(prev).add(`fix-${record.id}`));
    setSwapErrors(prev => { const n = { ...prev }; delete n[record.id]; return n; });

    try {
      const res = await fetch('/api/system/olt-report/swap-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: record.id,
          drANumber: lookup.drA.drNumber,
          drACorrectSerial: lookup.drA.oesSerial,
          drAWrongSerial: lookup.drA.oneMapSerial,
          drBNumber: lookup.drB.drNumber,
          drBCorrectSerial: lookup.drB.oesSerial,
          drBWrongSerial: lookup.drB.oneMapSerial,
          scenario,
          upsTransfer: lookup.upsTransfer,
        }),
      });
      const data = await res.json();
      const result = data.data || data;
      if (result.success) {
        let msg = scenario === 'clean_swap'
          ? `Swapped serials on both ${lookup.drA.drNumber} and ${lookup.drB.drNumber}`
          : `Fixed ${lookup.drA.drNumber}` + (scenario === 'fix_a_flag_b' ? ` and flagged ${lookup.drB.drNumber}` : '');
        if (result.upsTransfer?.success) {
          msg += ` | UPS transferred to ${lookup.drB.drNumber}`;
        }
        if (result.photoCopy?.success) {
          msg += ` | ${result.photoCopy.count} photos copied to ${lookup.drB.drNumber}`;
        }
        toast.success(msg);

        // Re-sync DR A's photos from 1Map (DR B's photos are copied server-side)
        fetch('/api/activate/fetch-photos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dropNumber: lookup.drA.drNumber, force: true }),
        }).then(r => r.json()).then(d => {
          const photoResult = d.data || d;
          if (photoResult.count > 0) {
            toast.success(`${lookup.drA.drNumber}: ${photoResult.count} photos refreshed`);
          }
        }).catch(() => { /* non-fatal */ });

        // Clean up state and refresh
        setSwapLookups(prev => { const n = { ...prev }; delete n[record.id]; return n; });
        fetchRecords('needs_investigation');
        fetchStats();
      } else {
        const errMsg = typeof result.error === 'string' ? result.error : result.error?.message || 'Swap fix failed';
        setSwapErrors(prev => ({ ...prev, [record.id]: errMsg }));
      }
    } catch {
      setSwapErrors(prev => ({ ...prev, [record.id]: 'Network error' }));
    } finally {
      setSwapLoading(prev => { const n = new Set(prev); n.delete(`fix-${record.id}`); return n; });
    }
  };

  // Selection helpers
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    const fixableRecords = records.filter((r) => r.olt_serial);
    if (selectedIds.size === fixableRecords.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(fixableRecords.map((r) => r.id)));
    }
  };

  const fixableRecords = records.filter((r) => r.olt_serial);
  const allSelected = fixableRecords.length > 0 && selectedIds.size === fixableRecords.length;

  // Sub-filter counts and filtered records for Investigate tab
  const investigateSubCounts = useMemo(() => {
    if (currentTab !== 'investigate') return { needs_investigation: 0, not_found: 0, other: 0, total: records.length };
    let ni = 0, nf = 0, other = 0;
    for (const r of records) {
      const s = r.fix_status || '';
      if (s === 'needs_investigation' || s === 'needs_reinvestigation') ni++;
      else if (s === 'not_found') nf++;
      else other++;
    }
    return { needs_investigation: ni, not_found: nf, other, total: records.length };
  }, [currentTab, records]);

  const displayRecords = useMemo(() => {
    if (currentTab !== 'investigate' || investigateSubFilter === 'all') return records;
    if (investigateSubFilter === 'needs_investigation') {
      return records.filter(r => r.fix_status === 'needs_investigation' || r.fix_status === 'needs_reinvestigation');
    }
    if (investigateSubFilter === 'not_found') {
      return records.filter(r => r.fix_status === 'not_found');
    }
    return records;
  }, [currentTab, investigateSubFilter, records]);

  // Show loading state while permissions are being resolved
  if (permissionsLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--ff-accent)]" />
        <span className="ml-3 text-[var(--ff-text-secondary)]">Loading...</span>
      </div>
    );
  }

  // Show access denied if no tabs are accessible
  if (accessibleTabs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
          <Lock className="w-8 h-8 text-red-400" />
        </div>
        <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">
          Access Restricted
        </h2>
        <p className="text-[var(--ff-text-secondary)] max-w-md">
          You don&apos;t have permission to access any OLT Report tabs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Date Filter Bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-[var(--ff-text-secondary)] mr-1">
          <Calendar className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
          Period:
        </span>
        {([
          { key: 'today', label: 'Today' },
          { key: 'yesterday', label: 'Yesterday' },
          { key: '7d', label: '7 Days' },
          { key: '30d', label: '30 Days' },
          { key: 'all', label: 'All' },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { setDateFilter(key); setCustomDate(''); }}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              dateFilter === key
                ? 'bg-[var(--ff-accent)] text-white border-[var(--ff-accent)]'
                : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:border-[var(--ff-accent)]'
            }`}
          >
            {label}
          </button>
        ))}
        <input
          type="date"
          value={customDate}
          onChange={(e) => {
            setCustomDate(e.target.value);
            if (e.target.value) setDateFilter('custom');
          }}
          className="px-2 py-1 text-xs rounded border bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border-[var(--ff-border-light)] focus:border-[var(--ff-accent)] outline-none"
          title="Pick a specific date"
        />
      </div>

      {/* Stats Bar — clickable cards filter history by status */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {([
          { key: 'pending', label: 'Pending Fixes', value: stats.pending, color: 'text-[var(--ff-text-primary)]', ring: 'ring-[var(--ff-accent)]' },
          { key: 'needs_investigation', label: 'Needs Investigation', value: stats.needs_investigation, color: 'text-amber-400', ring: 'ring-amber-400' },
          { key: 'escalated', label: 'Escalated', value: stats.escalated, color: 'text-red-400', ring: 'ring-red-400' },
          { key: 'fixed', label: 'Fixed', value: stats.fixed, color: 'text-green-400', ring: 'ring-green-400' },
          { key: 'resolved', label: 'Resolved', value: stats.resolved, color: 'text-blue-400', ring: 'ring-blue-400' },
          { key: 'all', label: 'Total Records', value: stats.total, color: 'text-[var(--ff-text-primary)]', ring: 'ring-[var(--ff-accent)]' },
        ] as const).map(({ key, label, value, color, ring }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(statusFilter === key ? 'all' : key)}
            className={`bg-[var(--ff-bg-secondary)] rounded-lg p-4 border text-left transition-all cursor-pointer ${
              statusFilter === key
                ? `border-transparent ring-2 ${ring}`
                : 'border-[var(--ff-border-light)] hover:border-[var(--ff-text-tertiary)]'
            }`}
          >
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
            <div className="text-sm text-[var(--ff-text-secondary)]">{label}</div>
          </button>
        ))}
      </div>

      {/* Background Process Status Banner - visible on ALL tabs */}
      {autoDetectStatus?.hasRun && autoDetectStatus.run && (
        autoDetectStatus.run.status === 'running' || autoDetectStatus.run.status === 'processing_queue'
      ) && (
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
              <span className="text-sm font-medium text-purple-300">
                OLT Mismatch Check Running
              </span>
              {autoDetectStatus.queue && autoDetectStatus.queue.total > 0 && (
                <span className="text-sm text-[var(--ff-text-secondary)]">
                  {autoDetectStatus.queue.completed}/{autoDetectStatus.queue.total} checked
                  <span className="ml-1 text-[var(--ff-text-tertiary)]">
                    ({Math.round((autoDetectStatus.queue.completed / autoDetectStatus.queue.total) * 100)}%)
                  </span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-green-400">{autoDetectStatus.run.matches} matches</span>
              {(autoDetectStatus.run.mismatchesNote4 > 0) && (
                <span className="text-amber-400">{autoDetectStatus.run.mismatchesNote4} mismatches</span>
              )}
              {(autoDetectStatus.run.mismatchesNote2 > 0) && (
                <span className="text-red-400">{autoDetectStatus.run.mismatchesNote2} not found</span>
              )}
              {(autoDetectStatus.run.upsSwaps > 0) && (
                <span className="text-orange-400">{autoDetectStatus.run.upsSwaps} swaps</span>
              )}
            </div>
          </div>
          {autoDetectStatus.queue && autoDetectStatus.queue.total > 0 && (
            <div className="mt-2 h-1.5 bg-purple-500/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500 rounded-full transition-all duration-500"
                style={{ width: `${(autoDetectStatus.queue.completed / autoDetectStatus.queue.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Tab Navigation - Only show tabs user has permission for */}
      <div className="border-b border-[var(--ff-border-light)]">
        <nav className="flex gap-1" aria-label="OLT Report Tabs">
          {accessibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setPage(1);
                  onTabChange(tab.id);
                }}
                className={`
                  flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors
                  ${
                    isActive
                      ? 'border-[var(--ff-accent)] text-[var(--ff-accent)]'
                      : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-medium)]'
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {tab.id === 'pending' && stats.pending > 0 && (
                  <span className="ml-1 px-2 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded-full">
                    {stats.pending}
                  </span>
                )}
                {tab.id === 'investigate' && stats.needs_investigation > 0 && (
                  <span className="ml-1 px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded-full">
                    {stats.needs_investigation}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-4 text-sm underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Tab Content */}
      {currentTab === 'import' && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          {/* Header */}
          <div className="p-6 border-b border-[var(--ff-border-light)]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <FileSpreadsheet className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                  Import OLT Report
                </h2>
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  Upload a Nokia OLT report Excel file to detect serial mismatches
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Project Select */}
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                Project (Optional)
              </label>
              <select
                value={project}
                onChange={(e) => setProject(e.target.value)}
                className="w-full max-w-sm px-3 py-2.5 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40"
              >
                <option value="">All Projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.project_code}>
                    {p.project_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Drop Zone */}
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                Excel File
              </label>
              <div
                onClick={() => !isUploading && document.getElementById('olt-file-input')?.click()}
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-blue-500', 'bg-blue-500/5'); }}
                onDragLeave={(e) => { e.currentTarget.classList.remove('border-blue-500', 'bg-blue-500/5'); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('border-blue-500', 'bg-blue-500/5');
                  const file = e.dataTransfer.files?.[0];
                  if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
                    setSelectedFile(file);
                    setUploadResult(null);
                  }
                }}
                className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                  selectedFile
                    ? 'border-green-500/40 bg-green-500/5'
                    : 'border-[var(--ff-border-light)] hover:border-blue-500/40 hover:bg-blue-500/5'
                } ${isUploading ? 'pointer-events-none opacity-60' : ''}`}
              >
                <input
                  id="olt-file-input"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange}
                  className="hidden"
                />
                {selectedFile ? (
                  <div className="flex items-center justify-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-green-500/10 flex items-center justify-center">
                      <FileSpreadsheet className="w-6 h-6 text-green-400" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-[var(--ff-text-primary)]">
                        {selectedFile.name}
                      </p>
                      <p className="text-xs text-[var(--ff-text-secondary)]">
                        {(selectedFile.size / 1024 / 1024).toFixed(1)} MB &middot; Ready to import
                      </p>
                    </div>
                    {!isUploading && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedFile(null); setUploadResult(null); }}
                        className="ml-2 p-1 rounded hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
                    <p className="text-sm text-[var(--ff-text-primary)] font-medium">
                      Drop your Nokia OLT report here
                    </p>
                    <p className="text-xs text-[var(--ff-text-secondary)] mt-1">
                      or click to browse &middot; .xlsx or .xls files
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* Import Button */}
            <button
              onClick={handleImport}
              disabled={!selectedFile || isUploading}
              className="flex items-center justify-center gap-2 w-full max-w-sm px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Importing &middot; This may take a minute...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Import Report
                </>
              )}
            </button>

            {/* Upload Result */}
            {uploadResult && (
              <div className="rounded-xl border border-green-500/20 overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 bg-green-500/10 border-b border-green-500/20">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span className="text-sm font-semibold text-green-400">Import Successful</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-[var(--ff-border-light)]">
                  <div className="p-4 text-center">
                    <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                      {uploadResult.stats.totalRecords}
                    </p>
                    <p className="text-xs text-[var(--ff-text-secondary)] mt-1">Total Records</p>
                  </div>
                  <div className="p-4 text-center">
                    <p className="text-2xl font-bold text-green-400">
                      {uploadResult.stats.matchCount}
                    </p>
                    <p className="text-xs text-[var(--ff-text-secondary)] mt-1">Matches</p>
                  </div>
                  <div className="p-4 text-center">
                    <p className="text-2xl font-bold text-amber-400">
                      {uploadResult.stats.mismatchCount}
                    </p>
                    <p className="text-xs text-[var(--ff-text-secondary)] mt-1">Mismatches</p>
                  </div>
                  <div className="p-4 text-center">
                    <p className="text-2xl font-bold text-[var(--ff-text-tertiary)]">
                      {uploadResult.stats.emptySerialCount}
                    </p>
                    <p className="text-xs text-[var(--ff-text-secondary)] mt-1">Empty Serials</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Auto-Detection Status */}
          {autoDetectStatus?.hasRun && autoDetectStatus.run && (
            <div className="border-t border-[var(--ff-border-light)]">
              <div className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                    <Zap className="w-4 h-4 text-purple-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">
                      Auto-Detection Status
                    </h3>
                    <p className="text-xs text-[var(--ff-text-secondary)]">
                      Last run: {new Date(autoDetectStatus.run.startedAt).toLocaleString()}
                    </p>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    autoDetectStatus.run.status === 'completed'
                      ? 'bg-green-500/20 text-green-400'
                      : autoDetectStatus.run.status === 'running' || autoDetectStatus.run.status === 'processing_queue'
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}>
                    {autoDetectStatus.run.status === 'processing_queue' ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Processing Queue
                      </span>
                    ) : autoDetectStatus.run.status === 'running' ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Running
                      </span>
                    ) : (
                      autoDetectStatus.run.status
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-[var(--ff-bg-primary)] rounded-lg p-3 border border-[var(--ff-border-light)]">
                    <p className="text-lg font-bold text-[var(--ff-text-primary)]">
                      {autoDetectStatus.run.totalOesRows}
                    </p>
                    <p className="text-xs text-[var(--ff-text-secondary)]">OES Rows</p>
                  </div>
                  <div className="bg-[var(--ff-bg-primary)] rounded-lg p-3 border border-[var(--ff-border-light)]">
                    <p className="text-lg font-bold text-green-400">
                      {autoDetectStatus.run.matches}
                    </p>
                    <p className="text-xs text-[var(--ff-text-secondary)]">Matches</p>
                  </div>
                  <div className="bg-[var(--ff-bg-primary)] rounded-lg p-3 border border-[var(--ff-border-light)]">
                    <p className="text-lg font-bold text-amber-400">
                      {autoDetectStatus.run.mismatchesNote4}
                    </p>
                    <p className="text-xs text-[var(--ff-text-secondary)]">Wrong Serial</p>
                  </div>
                  <div className="bg-[var(--ff-bg-primary)] rounded-lg p-3 border border-[var(--ff-border-light)]">
                    <p className="text-lg font-bold text-red-400">
                      {autoDetectStatus.run.mismatchesNote2}
                    </p>
                    <p className="text-xs text-[var(--ff-text-secondary)]">Not on 1Map</p>
                  </div>
                </div>

                {/* Cache & Queue details */}
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--ff-text-secondary)]">
                  <span className="flex items-center gap-1">
                    <Database className="w-3 h-3" />
                    Cache: {autoDetectStatus.run.cacheHits} hits / {autoDetectStatus.run.cacheMisses} misses
                  </span>
                  {autoDetectStatus.run.upsSwaps > 0 && (
                    <span className="text-orange-400">
                      UPS swaps: {autoDetectStatus.run.upsSwaps}
                    </span>
                  )}
                  {autoDetectStatus.run.duplicatesSkipped > 0 && (
                    <span>Duplicates skipped: {autoDetectStatus.run.duplicatesSkipped}</span>
                  )}
                </div>

                {/* Queue progress bar */}
                {autoDetectStatus.queue && autoDetectStatus.queue.total > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-[var(--ff-text-secondary)] font-medium">
                        1Map API Lookups: {autoDetectStatus.queue.completed}/{autoDetectStatus.queue.total}
                        {autoDetectStatus.queue.total > 0 && (
                          <span className="ml-1 text-[var(--ff-text-tertiary)]">
                            ({Math.round((autoDetectStatus.queue.completed / autoDetectStatus.queue.total) * 100)}%)
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-2">
                        {autoDetectStatus.queue.errors > 0 && (
                          <span className="text-red-400">{autoDetectStatus.queue.errors} errors</span>
                        )}
                        {autoDetectStatus.queue.pending > 0 ? (
                          <span className="flex items-center gap-1 text-blue-400">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            {autoDetectStatus.queue.pending} remaining
                          </span>
                        ) : (
                          <span className="text-green-400 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            Done
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          autoDetectStatus.queue.pending === 0 ? 'bg-green-500' : 'bg-purple-500'
                        }`}
                        style={{ width: `${autoDetectStatus.queue.total > 0 ? (autoDetectStatus.queue.completed / autoDetectStatus.queue.total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {(currentTab === 'pending' ||
        currentTab === 'investigate' ||
        currentTab === 'escalations') && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          {/* Bulk Action Bar */}
          {currentTab === 'pending' && records.length > 0 && (
            <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)]">
              <div className="flex items-center gap-4">
                <span className="text-sm text-[var(--ff-text-secondary)]">
                  {selectedIds.size > 0 ? (
                    <>{selectedIds.size} of {fixableRecords.length} selected</>
                  ) : (
                    <>{fixableRecords.length} records ready to fix</>
                  )}
                </span>
                {bulkFixResult && (
                  <span className="text-sm">
                    <span className="text-green-400">{bulkFixResult.successCount} fixed</span>
                    {bulkFixResult.failCount > 0 && (
                      <span className="text-red-400 ml-2">{bulkFixResult.failCount} failed</span>
                    )}
                    {bulkFixing && (
                      <span className="text-[var(--ff-text-secondary)] ml-2">
                        ({bulkFixResult.successCount + bulkFixResult.failCount}/{bulkFixResult.total})
                      </span>
                    )}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleSelectAll}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[var(--ff-bg-tertiary)] rounded hover:bg-[var(--ff-bg-tertiary)]/80"
                >
                  {allSelected ? (
                    <CheckSquare className="w-4 h-4 text-[var(--ff-accent)]" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                  {allSelected ? 'Deselect All' : 'Select All'}
                </button>
                <button
                  onClick={handleBulkFix}
                  disabled={selectedIds.size === 0 || bulkFixing}
                  className="flex items-center gap-2 px-4 py-1.5 bg-[var(--ff-accent)] text-white text-sm rounded hover:bg-[var(--ff-accent)]/80 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {bulkFixing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Fixing {selectedIds.size}...
                    </>
                  ) : (
                    <>
                      <Wrench className="w-4 h-4" />
                      Fix Selected ({selectedIds.size})
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Investigate sub-status filter */}
          {currentTab === 'investigate' && records.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--ff-border-light)]">
              <span className="text-xs text-[var(--ff-text-secondary)] mr-1">Filter:</span>
              {([
                { key: 'all', label: 'All', count: investigateSubCounts.total },
                { key: 'needs_investigation', label: 'Cross-DR Conflict', count: investigateSubCounts.needs_investigation },
                { key: 'not_found', label: 'Not on 1Map', count: investigateSubCounts.not_found },
              ] as const).map(({ key, label, count }) => (
                <button
                  key={key}
                  onClick={() => setInvestigateSubFilter(key)}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    investigateSubFilter === key
                      ? 'bg-[var(--ff-accent)] text-white border-[var(--ff-accent)]'
                      : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:border-[var(--ff-accent)]'
                  }`}
                >
                  {label} ({count})
                </button>
              ))}
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-accent)]" />
              <span className="ml-2 text-[var(--ff-text-secondary)]">Loading records...</span>
            </div>
          ) : records.length === 0 ? (
            <div className="text-center py-12 text-[var(--ff-text-tertiary)]">
              No records found
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                    {currentTab === 'pending' && (
                      <th className="w-12 py-3 px-4">
                        <button
                          onClick={toggleSelectAll}
                          className="text-[var(--ff-text-secondary)] hover:text-[var(--ff-accent)]"
                        >
                          {allSelected ? (
                            <CheckSquare className="w-5 h-5 text-[var(--ff-accent)]" />
                          ) : (
                            <Square className="w-5 h-5" />
                          )}
                        </button>
                      </th>
                    )}
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                      DR Number
                    </th>
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                      OLT Serial
                    </th>
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                      1Map Serial
                    </th>
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                      Status
                    </th>
                    <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayRecords.map((record) => (
                    <React.Fragment key={record.id}>
                    <tr
                      className={`border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] ${
                        selectedIds.has(record.id) ? 'bg-[var(--ff-accent)]/10' : ''
                      }`}
                    >
                      {currentTab === 'pending' && (
                        <td className="w-12 py-3 px-4">
                          {record.olt_serial ? (
                            <button
                              onClick={() => toggleSelect(record.id)}
                              className="text-[var(--ff-text-secondary)] hover:text-[var(--ff-accent)]"
                            >
                              {selectedIds.has(record.id) ? (
                                <CheckSquare className="w-5 h-5 text-[var(--ff-accent)]" />
                              ) : (
                                <Square className="w-5 h-5" />
                              )}
                            </button>
                          ) : (
                            <span className="w-5 h-5 block" />
                          )}
                        </td>
                      )}
                      <td className="py-3 px-4 text-[var(--ff-text-primary)] font-mono">
                        {record.drop_number}
                      </td>
                      <td className="py-3 px-4 text-green-400 font-mono">
                        {record.olt_serial || '-'}
                      </td>
                      <td className={`py-3 px-4 font-mono ${isStatusMismatch(record) ? 'text-green-400' : 'text-red-400'}`}>
                        {isStatusMismatch(record)
                          ? <span title="Serial matches OES">{record.olt_serial} <CheckCircle className="w-3 h-3 inline" /></span>
                          : (record.wrong_onemap_serial || record.onemap_serial || '-')}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            record.fix_status === 'fixed'
                              ? 'bg-green-500/20 text-green-400'
                              : record.fix_status === 'escalated'
                              ? 'bg-red-500/20 text-red-400'
                              : record.fix_status === 'needs_investigation'
                              ? 'bg-purple-500/20 text-purple-400'
                              : 'bg-amber-500/20 text-amber-400'
                          }`}
                        >
                          {record.fix_status || 'pending'}
                        </span>
                        {record.has_ups_swap && (
                          <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-orange-500/20 text-orange-400">
                            UPS Swap
                          </span>
                        )}
                        {isStatusMismatch(record) && (() => {
                          const ctx = getInvestigationContext(record);
                          return (
                            <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-400" title={ctx?.message}>
                              Status: {ctx?.currentStatus || 'wrong'}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <a
                            href={`https://www.1map.co.za/apps/app?workspace=Fibertime%20Installations&selected=${record.drop_number}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-[var(--ff-text-secondary)] hover:text-[var(--ff-accent)] transition-colors"
                            title="View in 1Map"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                          {currentTab === 'pending' && record.olt_serial && (
                            <div className="flex flex-col items-end gap-1">
                              <button
                                onClick={() => handleFix(record)}
                                disabled={fixing === record.id || bulkFixing}
                                className="flex items-center gap-1 px-3 py-1.5 bg-[var(--ff-accent)] text-white text-xs rounded hover:bg-[var(--ff-accent)]/80 disabled:opacity-50"
                              >
                                {fixing === record.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Wrench className="w-3 h-3" />
                                )}
                                {isStatusMismatch(record) ? 'Fix Status' : 'Fix'}
                              </button>
                              {fixErrors[record.id] && (
                                <span className="text-[10px] text-red-400 max-w-[160px] text-right leading-tight">
                                  {fixErrors[record.id]}
                                </span>
                              )}
                            </div>
                          )}
                          {currentTab === 'investigate' && (
                            <>
                              <button
                                onClick={() => setShowResolveModal(record.id)}
                                className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs rounded hover:bg-green-700"
                                title="Mark as resolved"
                              >
                                <CheckCircle className="w-3 h-3" />
                                Resolve
                              </button>
                              <button
                                onClick={() => setShowEscalateModal(record.id)}
                                className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                                title="Escalate to admin"
                              >
                                <AlertTriangle className="w-3 h-3" />
                                Escalate
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Investigation context row - collapsible, shown below the record on Investigate tab */}
                    {currentTab === 'investigate' && record.investigation_context && (() => {
                      try {
                        const ctx: InvestigationContext = JSON.parse(record.investigation_context);
                        const isExpanded = expandedContexts.has(record.id);
                        return (
                          <tr key={`${record.id}-ctx`} className="border-b border-[var(--ff-border-light)]">
                            <td colSpan={5} className="py-1.5 px-4">
                              <button
                                onClick={() => toggleContext(record.id)}
                                className="w-full bg-purple-500/5 border border-purple-500/20 rounded-lg text-xs text-left hover:bg-purple-500/10 transition-colors"
                              >
                                <div className="flex items-center gap-2 px-3 py-2">
                                  {isExpanded ? (
                                    <ChevronDown className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                                  )}
                                  <AlertTriangle className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                                  <span className="font-semibold text-purple-300">Cross-DR Conflict</span>
                                  <span className="text-[var(--ff-text-secondary)]">
                                    — ONT <span className="font-mono text-red-400">{ctx.wrongSerial}</span> belongs to <span className="font-mono text-[var(--ff-accent)]">{ctx.belongsToDr}</span> ({ctx.belongsToTeam})
                                  </span>
                                </div>
                              </button>
                              {isExpanded && (
                                <div className="bg-purple-500/5 border border-t-0 border-purple-500/20 rounded-b-lg px-3 py-2.5 -mt-1 space-y-2">
                                  <p className="text-xs text-[var(--ff-text-secondary)] leading-relaxed">
                                    The ONT serial <span className="font-mono text-red-400">{ctx.wrongSerial}</span> currently on 1Map
                                    belongs to <a
                                      href={`https://www.1map.co.za/apps/app?workspace=Fibertime%20Installations&selected=${ctx.belongsToDr}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-mono text-[var(--ff-accent)] hover:underline"
                                      onClick={e => e.stopPropagation()}
                                    >{ctx.belongsToDr}</a> ({ctx.belongsToTeam}).
                                    {ctx.wrongUps && (
                                      <> UPS: <span className="font-mono text-orange-400">{ctx.wrongUps}</span>.</>
                                    )}
                                  </p>
                                  <div className="flex gap-4 text-xs text-[var(--ff-text-tertiary)]">
                                    <span>1Map records: {ctx.totalPropRecords}</span>
                                    <span className="text-green-400">Correct: {ctx.correctRecords}</span>
                                    <span className="text-red-400">Wrong: {ctx.wrongRecords}</span>
                                    {ctx.swappedRecords > 0 && (
                                      <span className="text-orange-400">Swapped: {ctx.swappedRecords}</span>
                                    )}
                                  </div>
                                  {/* Cross-DR Swap Panel */}
                                  <div className="mt-1 pt-2 border-t border-purple-500/10">
                                    {!swapLookups[record.id] ? (
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleSwapLookup(record); }}
                                          disabled={swapLoading.has(record.id)}
                                          className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-xs rounded hover:bg-purple-700 disabled:opacity-50"
                                        >
                                          {swapLoading.has(record.id) ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Search className="w-3 h-3" />
                                          )}
                                          Check Other DR
                                        </button>
                                        {swapErrors[record.id] && (
                                          <span className="text-[10px] text-red-400">{swapErrors[record.id]}</span>
                                        )}
                                      </div>
                                    ) : (() => {
                                      const lookup = swapLookups[record.id];
                                      const isFixing = swapLoading.has(`fix-${record.id}`);
                                      const scenarioLabels: Record<string, { label: string; color: string }> = {
                                        clean_swap: { label: 'Clean Swap', color: 'text-green-400' },
                                        fix_a_only: { label: lookup.upsTransfer?.needed ? 'Fix A + Transfer UPS' : 'Fix DR A Only', color: lookup.upsTransfer?.needed ? 'text-amber-400' : 'text-blue-400' },
                                        fix_a_flag_b: { label: 'Fix A + Flag B', color: 'text-amber-400' },
                                        fix_a_b_missing: { label: 'Fix A (B Missing)', color: 'text-amber-400' },
                                      };
                                      const sc = scenarioLabels[lookup.scenario] || { label: lookup.scenario, color: 'text-gray-400' };
                                      return (
                                        <div className="space-y-2">
                                          {/* Comparison card */}
                                          <div className="grid grid-cols-2 gap-3 bg-[var(--ff-bg-primary)] rounded-lg p-3 border border-[var(--ff-border-light)]">
                                            <div>
                                              <div className="flex items-center gap-2 mb-1">
                                                <span className="text-[10px] font-semibold text-[var(--ff-text-secondary)] uppercase">DR A ({lookup.drA.drNumber})</span>
                                                <a href={`/activate/${lookup.drA.drNumber}`} target="_blank" rel="noopener noreferrer" className="text-[var(--ff-accent)] hover:text-[var(--ff-accent)]/80" title="DR Review" onClick={e => e.stopPropagation()}>
                                                  <Search className="w-3 h-3" />
                                                </a>
                                                <a href={`https://www.1map.co.za/apps/app?workspace=Fibertime%20Installations&selected=${lookup.drA.drNumber}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300" title="View in 1Map" onClick={e => e.stopPropagation()}>
                                                  <ExternalLink className="w-3 h-3" />
                                                </a>
                                              </div>
                                              <p className="text-xs text-[var(--ff-text-secondary)]">
                                                OES: <span className="font-mono text-green-400">{lookup.drA.oesSerial}</span>
                                              </p>
                                              <p className="text-xs text-[var(--ff-text-secondary)]">
                                                1Map: <span className="font-mono text-red-400">{lookup.drA.oneMapSerial}</span> <XCircle className="w-3 h-3 inline text-red-400" />
                                              </p>
                                              {lookup.drA.oneMapUps && (
                                                <p className="text-xs text-[var(--ff-text-secondary)]">
                                                  UPS: <span className={`font-mono ${lookup.upsTransfer?.needed ? 'text-amber-400' : 'text-gray-400'}`}>{lookup.drA.oneMapUps}</span>
                                                  {lookup.upsTransfer?.needed && <span className="text-[10px] text-amber-400 ml-1">(belongs to DR B)</span>}
                                                </p>
                                              )}
                                            </div>
                                            <div>
                                              <div className="flex items-center gap-2 mb-1">
                                                <span className="text-[10px] font-semibold text-[var(--ff-text-secondary)] uppercase">DR B ({lookup.drB.drNumber})</span>
                                                <a href={`/activate/${lookup.drB.drNumber}`} target="_blank" rel="noopener noreferrer" className="text-[var(--ff-accent)] hover:text-[var(--ff-accent)]/80" title="DR Review" onClick={e => e.stopPropagation()}>
                                                  <Search className="w-3 h-3" />
                                                </a>
                                                <a href={`https://www.1map.co.za/apps/app?workspace=Fibertime%20Installations&selected=${lookup.drB.drNumber}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300" title="View in 1Map" onClick={e => e.stopPropagation()}>
                                                  <ExternalLink className="w-3 h-3" />
                                                </a>
                                              </div>
                                              <p className="text-xs text-[var(--ff-text-secondary)]">
                                                OES: <span className="font-mono text-green-400">{lookup.drB.oesSerial || 'N/A'}</span>
                                              </p>
                                              <p className="text-xs text-[var(--ff-text-secondary)]">
                                                1Map: {lookup.drB.foundOn1Map ? (
                                                  <>
                                                    <span className={`font-mono ${lookup.drB.oneMapSerial?.toUpperCase() === lookup.drB.oesSerial?.toUpperCase() ? 'text-green-400' : 'text-red-400'}`}>
                                                      {lookup.drB.oneMapSerial}
                                                    </span>
                                                    {lookup.drB.oneMapSerial?.toUpperCase() === lookup.drB.oesSerial?.toUpperCase()
                                                      ? <CheckCircle className="w-3 h-3 inline text-green-400 ml-0.5" />
                                                      : <XCircle className="w-3 h-3 inline text-red-400 ml-0.5" />}
                                                  </>
                                                ) : (
                                                  <span className="text-gray-500 italic">Not on 1Map</span>
                                                )}
                                              </p>
                                              {lookup.drB.foundOn1Map && (
                                                <p className="text-xs text-[var(--ff-text-secondary)]">
                                                  UPS: {lookup.drB.oneMapUps ? (
                                                    <span className="font-mono text-gray-400">{lookup.drB.oneMapUps}</span>
                                                  ) : (
                                                    <span className={`italic ${lookup.upsTransfer?.needed ? 'text-amber-400' : 'text-gray-500'}`}>
                                                      {lookup.upsTransfer?.needed ? 'Empty — will receive transfer' : 'Empty'}
                                                    </span>
                                                  )}
                                                </p>
                                              )}
                                            </div>
                                          </div>
                                          {/* UPS transfer notice */}
                                          {lookup.upsTransfer?.needed && (
                                            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 rounded border border-amber-500/20">
                                              <ArrowLeftRight className="w-3 h-3 text-amber-400" />
                                              <span className="text-[10px] text-amber-400">
                                                UPS {lookup.upsTransfer.serial} will transfer: {lookup.upsTransfer.from} → {lookup.upsTransfer.to}
                                              </span>
                                            </div>
                                          )}
                                          {/* Scenario + actions */}
                                          <div className="flex items-center justify-between">
                                            <span className={`text-xs font-medium ${sc.color}`}>
                                              Scenario: {sc.label}
                                            </span>
                                            <div className="flex items-center gap-2">
                                              {swapErrors[record.id] && (
                                                <span className="text-[10px] text-red-400">{swapErrors[record.id]}</span>
                                              )}
                                              {lookup.scenario === 'clean_swap' && (
                                                <button
                                                  onClick={(e) => { e.stopPropagation(); handleSwapFix(record, lookup, true); }}
                                                  disabled={isFixing}
                                                  className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
                                                >
                                                  {isFixing ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowLeftRight className="w-3 h-3" />}
                                                  Swap Both DRs
                                                </button>
                                              )}
                                              <button
                                                onClick={(e) => { e.stopPropagation(); handleSwapFix(record, lookup, false); }}
                                                disabled={isFixing}
                                                className={`flex items-center gap-1 px-3 py-1.5 text-white text-xs rounded disabled:opacity-50 ${lookup.upsTransfer?.needed ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                                              >
                                                {isFixing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wrench className="w-3 h-3" />}
                                                {lookup.upsTransfer?.needed ? 'Fix A + Transfer UPS' : 'Fix DR A Only'}
                                              </button>
                                            </div>
                                          </div>
                                          <p className="text-[10px] text-[var(--ff-text-tertiary)] leading-relaxed">{lookup.recommendation}</p>
                                        </div>
                                      );
                                    })()}
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      } catch {
                        return null;
                      }
                    })()}
                  </React.Fragment>
                ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {total > pageSize && (
            <div className="flex items-center justify-between p-4 border-t border-[var(--ff-border-light)]">
              <span className="text-sm text-[var(--ff-text-secondary)]">
                Showing {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)} of {total}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 text-sm bg-[var(--ff-bg-tertiary)] rounded disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page * pageSize >= total}
                  className="px-3 py-1 text-sm bg-[var(--ff-bg-tertiary)] rounded disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {currentTab === 'history' && (
        <div className="space-y-6">
          {/* Fix Activity */}
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
            <div className="px-5 py-3 border-b border-[var(--ff-border-light)]">
              <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">
                {statusFilter === 'all' ? 'All Records' : statusFilter === 'fixed' ? 'Fixes' : statusFilter === 'pending' ? 'Pending' : statusFilter === 'needs_investigation' ? 'Investigate' : statusFilter === 'escalated' ? 'Escalated' : statusFilter === 'resolved' ? 'Resolved' : 'Records'}{' '}
                {fixHistory.length < total ? `(${fixHistory.length} of ${total})` : `(${total})`}
              </h3>
            </div>
            {fixHistory.length === 0 ? (
              <div className="text-center py-8 text-[var(--ff-text-tertiary)] text-sm">
                No records found for this filter
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                      <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                        DR Number
                      </th>
                      <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                        OLT Serial
                      </th>
                      {statusFilter !== 'fixed' && (
                        <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                          Status
                        </th>
                      )}
                      <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                        {statusFilter === 'fixed' ? 'Result' : '1Map Serial'}
                      </th>
                      <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                        {statusFilter === 'fixed' ? 'Old Value' : 'Details'}
                      </th>
                      <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                        Date
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {fixHistory.map((record) => {
                      let oldVal = '-';
                      try {
                        const parsed = record.fix_old_value ? JSON.parse(record.fix_old_value) : null;
                        oldVal = parsed?.ont_old || '-';
                      } catch { oldVal = record.fix_old_value || '-'; }

                      const statusBadge = (() => {
                        const s = record.fix_status || 'pending';
                        if (s === 'fixed') return { cls: 'bg-green-500/20 text-green-400', text: 'fixed' };
                        if (s === 'pending') return { cls: 'bg-amber-500/20 text-amber-400', text: 'pending' };
                        if (s === 'needs_investigation') return { cls: 'bg-orange-500/20 text-orange-400', text: 'investigate' };
                        if (s === 'not_found') return { cls: 'bg-red-500/20 text-red-400', text: 'not found' };
                        if (s === 'escalated') return { cls: 'bg-red-500/20 text-red-400', text: 'escalated' };
                        if (s === 'resolved') return { cls: 'bg-blue-500/20 text-blue-400', text: 'resolved' };
                        return { cls: 'bg-gray-500/20 text-gray-400', text: s };
                      })();

                      return (
                        <tr
                          key={record.id}
                          className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]"
                        >
                          <td className="py-3 px-4 text-[var(--ff-text-primary)] font-mono">
                            {record.drop_number}
                          </td>
                          <td className="py-3 px-4 text-green-400 font-mono text-xs">
                            {record.olt_serial || '-'}
                          </td>
                          {statusFilter !== 'fixed' && (
                            <td className="py-3 px-4">
                              <span className={`px-2 py-0.5 rounded text-xs ${statusBadge.cls}`}>
                                {statusBadge.text}
                              </span>
                            </td>
                          )}
                          <td className="py-3 px-4 font-mono text-xs">
                            {statusFilter === 'fixed' ? (
                              <span className={`px-2 py-0.5 rounded text-xs ${
                                record.fix_result === 'success'
                                  ? 'bg-green-500/20 text-green-400'
                                  : record.fix_result === 'already_correct'
                                  ? 'bg-blue-500/20 text-blue-400'
                                  : 'bg-amber-500/20 text-amber-400'
                              }`}>
                                {record.fix_result === 'already_correct' ? 'verified' : record.fix_result || 'fixed'}
                              </span>
                            ) : (
                              <span className="text-red-400">{record.wrong_onemap_serial || '-'}</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-red-400 font-mono text-xs">
                            {statusFilter === 'fixed' ? oldVal : (record.wrong_onemap_serial && record.wrong_onemap_serial !== record.olt_serial ? `Wrong: ${record.wrong_onemap_serial}` : '-')}
                          </td>
                          <td className="py-3 px-4 text-[var(--ff-text-secondary)]">
                            {(record.fix_attempted_at || record.created_at)
                              ? new Date(record.fix_attempted_at || record.created_at || '').toLocaleString()
                              : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Import History */}
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
            <div className="px-5 py-3 border-b border-[var(--ff-border-light)]">
              <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">Import History</h3>
            </div>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-accent)]" />
              </div>
            ) : imports.length === 0 ? (
              <div className="text-center py-8 text-[var(--ff-text-tertiary)] text-sm">
                No imports yet
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                      <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                        Filename
                      </th>
                      <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                        Project
                      </th>
                      <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                        Total
                      </th>
                      <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                        Mismatches
                      </th>
                      <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                        Imported
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {imports.map((imp) => (
                      <tr
                        key={imp.id}
                        className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]"
                      >
                        <td className="py-3 px-4 text-[var(--ff-text-primary)]">{imp.filename}</td>
                        <td className="py-3 px-4 text-[var(--ff-text-secondary)]">
                          {imp.project || '-'}
                        </td>
                        <td className="py-3 px-4 text-right text-[var(--ff-text-primary)]">
                          {imp.total_records}
                        </td>
                        <td className="py-3 px-4 text-right text-amber-400">{imp.mismatch_count}</td>
                        <td className="py-3 px-4 text-[var(--ff-text-secondary)]">
                          {new Date(imp.imported_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {currentTab === 'reporting' && (
        <div className="space-y-6">
          {/* Period Selector and Export */}
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <span className="text-sm text-[var(--ff-text-secondary)]">Period:</span>
              <div className="flex gap-2">
                {(['today', 'yesterday', 'week', '30days', 'all'] as ReportPeriod[]).map((period) => (
                  <button
                    key={period}
                    onClick={() => setReportPeriod(period)}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      reportPeriod === period
                        ? 'bg-[var(--ff-accent)] text-white'
                        : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                    }`}
                  >
                    {period === 'all'
                      ? 'All Time'
                      : period === '30days'
                      ? '30 Days'
                      : period.charAt(0).toUpperCase() + period.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={handleExportCSV}
              disabled={exporting || !reportData}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
              title={`Export ${reportStatusFilter === 'all' ? 'all records' : reportStatusFilter.replace(/_/g, ' ')} to CSV`}
            >
              {exporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              Export {reportStatusFilter === 'all' ? 'All' : reportStatusFilter.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} CSV
            </button>
          </div>

          {reportLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-accent)]" />
            </div>
          ) : reportData ? (
            <>
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <button
                  onClick={() => setReportStatusFilter('all')}
                  className={`bg-[var(--ff-bg-secondary)] rounded-lg p-4 border text-left transition-colors ${
                    reportStatusFilter === 'all' ? 'border-[var(--ff-accent)]' : 'border-[var(--ff-border-light)] hover:border-[var(--ff-border-medium)]'
                  }`}
                >
                  <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                    {reportData.summary.total}
                  </div>
                  <div className="text-sm text-[var(--ff-text-secondary)]">Total Records</div>
                </button>
                <button
                  onClick={() => setReportStatusFilter('fixed')}
                  className={`bg-[var(--ff-bg-secondary)] rounded-lg p-4 border text-left transition-colors ${
                    reportStatusFilter === 'fixed' ? 'border-green-400' : 'border-[var(--ff-border-light)] hover:border-[var(--ff-border-medium)]'
                  }`}
                >
                  <div className="text-2xl font-bold text-green-400">{reportData.summary.fixed}</div>
                  <div className="text-sm text-[var(--ff-text-secondary)]">Fixed</div>
                </button>
                <button
                  onClick={() => setReportStatusFilter('pending')}
                  className={`bg-[var(--ff-bg-secondary)] rounded-lg p-4 border text-left transition-colors ${
                    reportStatusFilter === 'pending' ? 'border-amber-400' : 'border-[var(--ff-border-light)] hover:border-[var(--ff-border-medium)]'
                  }`}
                >
                  <div className="text-2xl font-bold text-amber-400">
                    {reportData.summary.pending}
                  </div>
                  <div className="text-sm text-[var(--ff-text-secondary)]">Pending</div>
                </button>
                <button
                  onClick={() => setReportStatusFilter('empty_serial')}
                  className={`bg-[var(--ff-bg-secondary)] rounded-lg p-4 border text-left transition-colors ${
                    reportStatusFilter === 'empty_serial' ? 'border-gray-400' : 'border-[var(--ff-border-light)] hover:border-[var(--ff-border-medium)]'
                  }`}
                >
                  <div className="text-2xl font-bold text-[var(--ff-text-tertiary)]">
                    {reportData.summary.empty_serial}
                  </div>
                  <div className="text-sm text-[var(--ff-text-secondary)]">Empty Serial</div>
                </button>
                <button
                  onClick={() => setReportStatusFilter('not_found')}
                  className={`bg-[var(--ff-bg-secondary)] rounded-lg p-4 border text-left transition-colors ${
                    reportStatusFilter === 'not_found' ? 'border-red-400' : 'border-[var(--ff-border-light)] hover:border-[var(--ff-border-medium)]'
                  }`}
                >
                  <div className="text-2xl font-bold text-red-400">
                    {reportData.summary.not_found}
                  </div>
                  <div className="text-sm text-[var(--ff-text-secondary)]">Not Found</div>
                </button>
              </div>

              {/* Records Table */}
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
                <div className="p-4 border-b border-[var(--ff-border-light)]">
                  <h3 className="font-semibold text-[var(--ff-text-primary)]">
                    Records {reportStatusFilter !== 'all' && `(${reportStatusFilter})`}
                  </h3>
                </div>
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-[var(--ff-bg-tertiary)]">
                      <tr className="border-b border-[var(--ff-border-light)]">
                        <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">DR Number</th>
                        <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">OLT Serial</th>
                        <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">1Map Serial</th>
                        <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Status</th>
                        <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Import File</th>
                        <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.records
                        .filter(r => reportStatusFilter === 'all' || r.fix_status === reportStatusFilter)
                        .slice(0, 100)
                        .map((record) => (
                          <tr key={record.id} className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]">
                            <td className="py-3 px-4 text-[var(--ff-text-primary)] font-mono">{record.drop_number}</td>
                            <td className="py-3 px-4 text-green-400 font-mono">{record.olt_serial || '-'}</td>
                            <td className="py-3 px-4 text-red-400 font-mono">{record.wrong_onemap_serial || '-'}</td>
                            <td className="py-3 px-4">
                              <span className={`px-2 py-1 rounded text-xs ${
                                record.fix_status === 'fixed' ? 'bg-green-500/20 text-green-400' :
                                record.fix_status === 'pending' ? 'bg-amber-500/20 text-amber-400' :
                                record.fix_status === 'not_found' ? 'bg-red-500/20 text-red-400' :
                                'bg-gray-500/20 text-gray-400'
                              }`}>
                                {record.fix_status || 'unknown'}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-[var(--ff-text-secondary)]">{record.import_filename || '-'}</td>
                            <td className="py-3 px-4 text-[var(--ff-text-secondary)]">
                              {record.created_at ? new Date(record.created_at).toLocaleDateString() : '-'}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {reportData.records.filter(r => reportStatusFilter === 'all' || r.fix_status === reportStatusFilter).length > 100 && (
                    <div className="p-4 text-center text-sm text-[var(--ff-text-secondary)]">
                      Showing first 100 records. Export CSV for complete data.
                    </div>
                  )}
                </div>
              </div>

              {/* Imports Summary */}
              {reportData.imports.length > 0 && (
                <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
                  <div className="p-4 border-b border-[var(--ff-border-light)]">
                    <h3 className="font-semibold text-[var(--ff-text-primary)]">Imports Summary</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                          <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Filename</th>
                          <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Project</th>
                          <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Mismatches</th>
                          <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Fixed</th>
                          <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Pending</th>
                          <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Imported</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.imports.map((imp) => (
                          <tr key={imp.id} className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]">
                            <td className="py-3 px-4 text-[var(--ff-text-primary)]">{imp.filename}</td>
                            <td className="py-3 px-4 text-[var(--ff-text-secondary)]">{imp.project || '-'}</td>
                            <td className="py-3 px-4 text-right text-amber-400">{imp.mismatch_count}</td>
                            <td className="py-3 px-4 text-right text-green-400">{imp.fixed_count}</td>
                            <td className="py-3 px-4 text-right text-[var(--ff-text-secondary)]">{imp.pending_count}</td>
                            <td className="py-3 px-4 text-[var(--ff-text-secondary)]">
                              {new Date(imp.imported_at).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12 text-[var(--ff-text-tertiary)]">
              No report data available
            </div>
          )}
        </div>
      )}

      {/* Resolve Modal */}
      {showResolveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 w-full max-w-md border border-[var(--ff-border-light)]">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
              Resolve Investigation
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                  Resolution Type
                </label>
                <select
                  value={resolutionType}
                  onChange={(e) => setResolutionType(e.target.value)}
                  className="w-full px-4 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
                >
                  <option value="">Select resolution...</option>
                  <option value="manually_fixed">Manually Fixed in 1Map</option>
                  <option value="closed_invalid">Closed - Invalid Record</option>
                  <option value="closed_no_data">Closed - Missing Data</option>
                  <option value="closed_false_positive">Closed - False Positive</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                  Notes (Optional)
                </label>
                <textarea
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
                  placeholder="Add any notes about this resolution..."
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowResolveModal(null);
                    setResolutionType('');
                    setResolutionNotes('');
                  }}
                  className="px-4 py-2 text-sm bg-[var(--ff-bg-tertiary)] rounded-lg hover:bg-[var(--ff-bg-tertiary)]/80"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleResolve(showResolveModal)}
                  disabled={!resolutionType || resolving}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {resolving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4" />
                  )}
                  Resolve
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Escalate Modal */}
      {showEscalateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 w-full max-w-md border border-[var(--ff-border-light)]">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
              Escalate to Admin
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                  Escalate To
                </label>
                <select
                  value={escalateTo}
                  onChange={(e) => setEscalateTo(e.target.value)}
                  className="w-full px-4 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
                >
                  <option value="">Select admin...</option>
                  {adminUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name || user.email}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                  Notes (Optional)
                </label>
                <textarea
                  value={escalateNotes}
                  onChange={(e) => setEscalateNotes(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
                  placeholder="Explain why this needs escalation..."
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowEscalateModal(null);
                    setEscalateTo('');
                    setEscalateNotes('');
                  }}
                  className="px-4 py-2 text-sm bg-[var(--ff-bg-tertiary)] rounded-lg hover:bg-[var(--ff-bg-tertiary)]/80"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleEscalate(showEscalateModal)}
                  disabled={!escalateTo || escalating}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {escalating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <AlertTriangle className="w-4 h-4" />
                  )}
                  Escalate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
