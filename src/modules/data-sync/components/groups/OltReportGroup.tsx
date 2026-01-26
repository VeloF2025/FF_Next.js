/**
 * OLT Report Group Component
 * Wraps OLT report tabs: Import, Pending, Investigate, Escalations, History, Reporting
 *
 * Note: This component embeds the full OLT report functionality inline since the
 * original page (1785 lines) has complex state management that's tightly coupled.
 * A future refactor could extract these into separate components.
 */

'use client';

import React, { useState, useCallback, useEffect } from 'react';
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
} from 'lucide-react';
import type { OltTabId } from '../../types';

// Tab configuration
const TABS: { id: OltTabId; label: string; icon: React.ElementType }[] = [
  { id: 'import', label: 'Import', icon: Upload },
  { id: 'pending', label: 'Fixable', icon: Wrench },
  { id: 'investigate', label: 'Investigate', icon: Search },
  { id: 'escalations', label: 'Escalations', icon: AlertTriangle },
  { id: 'history', label: 'History', icon: History },
  { id: 'reporting', label: 'Reporting', icon: BarChart3 },
];

type ReportPeriod = 'today' | 'yesterday' | 'week' | '30days' | 'all';

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
  fix_result?: string | null;
  fix_old_value?: string | null;
  status?: string;
  comparison_status?: string;
  row_index?: number;
  import_filename?: string;
  import_date?: string;
  project?: string;
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
  const currentTab = (activeTab as OltTabId) || 'pending';
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkFixing, setBulkFixing] = useState(false);
  const [bulkFixResult, setBulkFixResult] = useState<{
    total: number;
    successCount: number;
    failCount: number;
  } | null>(null);

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

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/system/olt-report/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data.data || data);
      }
    } catch {
      // Silently fail
    }
  }, []);

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

  // Fetch imports history
  const fetchImports = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/system/olt-report/imports');
      if (res.ok) {
        const data = await res.json();
        setImports(data.data?.imports || data.imports || []);
      }
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false);
    }
  }, []);

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
      const res = await fetch(`/api/system/olt-report/reporting?period=${reportPeriod}&format=csv`);
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `olt-report-${reportPeriod}-${new Date().toISOString().split('T')[0]}.csv`;
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

  // Load data based on current tab
  useEffect(() => {
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
      if (data.success) {
        setUploadResult({ success: true, stats: data.stats });
        fetchStats();
        setSelectedFile(null);
      } else {
        setError(data.error || 'Import failed');
      }
    } catch {
      setError('Import failed');
    } finally {
      setIsUploading(false);
    }
  };

  // Handle fix
  const handleFix = async (record: OltRecord) => {
    if (!record.olt_serial) return;

    setFixing(record.id);
    try {
      const res = await fetch('/api/system/olt-report/fix-1map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drNumber: record.drop_number,
          correctSerial: record.olt_serial,
          wrongSerial: record.wrong_onemap_serial,
        }),
      });

      const data = await res.json();
      if (data.success || data.data?.success) {
        fetchRecords('pending');
        fetchStats();
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(record.id);
          return next;
        });
      } else {
        setError(data.error?.message || data.error || 'Fix failed');
      }
    } catch {
      setError('Fix failed');
    } finally {
      setFixing(null);
    }
  };

  // Handle bulk fix
  const handleBulkFix = async () => {
    const selectedRecords = records.filter(
      (r) => selectedIds.has(r.id) && r.olt_serial
    );
    if (selectedRecords.length === 0) return;

    setBulkFixing(true);
    setBulkFixResult(null);
    setError(null);

    try {
      const res = await fetch('/api/system/olt-report/fix-1map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bulk: true,
          items: selectedRecords.map((r) => ({
            drNumber: r.drop_number,
            correctSerial: r.olt_serial,
            wrongSerial: r.wrong_onemap_serial,
          })),
        }),
      });

      const data = await res.json();
      const result = data.data || data;

      if (result.bulk) {
        setBulkFixResult({
          total: result.total,
          successCount: result.successCount,
          failCount: result.failCount,
        });
        setSelectedIds(new Set());
        fetchRecords('pending');
        fetchStats();
      } else {
        setError(data.error?.message || 'Bulk fix failed');
      }
    } catch {
      setError('Bulk fix failed');
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
        setError(data.error?.message || data.error || 'Resolve failed');
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
        setError(data.error?.message || data.error || 'Escalate failed');
      }
    } catch {
      setError('Escalate failed');
    } finally {
      setEscalating(false);
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

  return (
    <div className="space-y-6">
      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
          <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.pending}</div>
          <div className="text-sm text-[var(--ff-text-secondary)]">Pending Fixes</div>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
          <div className="text-2xl font-bold text-amber-400">{stats.needs_investigation}</div>
          <div className="text-sm text-[var(--ff-text-secondary)]">Needs Investigation</div>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
          <div className="text-2xl font-bold text-red-400">{stats.escalated}</div>
          <div className="text-sm text-[var(--ff-text-secondary)]">Escalated</div>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
          <div className="text-2xl font-bold text-green-400">{stats.fixed}</div>
          <div className="text-sm text-[var(--ff-text-secondary)]">Fixed</div>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
          <div className="text-2xl font-bold text-blue-400">{stats.resolved}</div>
          <div className="text-sm text-[var(--ff-text-secondary)]">Resolved</div>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
          <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.total}</div>
          <div className="text-sm text-[var(--ff-text-secondary)]">Total Records</div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-[var(--ff-border-light)]">
        <nav className="flex gap-1" aria-label="OLT Report Tabs">
          {TABS.map((tab) => {
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
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
            Import OLT Report
          </h2>
          <p className="text-sm text-[var(--ff-text-secondary)] mb-6">
            Upload a Nokia OLT report Excel file to import mismatch data
          </p>

          <div className="space-y-4">
            {/* Project Select */}
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                Project (Optional)
              </label>
              <select
                value={project}
                onChange={(e) => setProject(e.target.value)}
                className="w-full max-w-md px-4 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
              >
                <option value="">All Projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.project_code}>
                    {p.project_name}
                  </option>
                ))}
              </select>
            </div>

            {/* File Input */}
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                Excel File
              </label>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                className="block w-full max-w-md text-sm text-[var(--ff-text-secondary)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[var(--ff-accent)] file:text-white hover:file:bg-[var(--ff-accent)]/80"
              />
            </div>

            {/* Upload Button */}
            <button
              onClick={handleImport}
              disabled={!selectedFile || isUploading}
              className="flex items-center gap-2 px-6 py-2 bg-[var(--ff-accent)] text-white rounded-lg hover:bg-[var(--ff-accent)]/80 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Import
                </>
              )}
            </button>

            {/* Upload Result */}
            {uploadResult && (
              <div className="mt-4 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                <div className="flex items-center gap-2 text-green-400 font-semibold mb-2">
                  <CheckCircle className="w-5 h-5" />
                  Import Successful
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-[var(--ff-text-secondary)]">Total:</span>{' '}
                    <span className="text-[var(--ff-text-primary)]">
                      {uploadResult.stats.totalRecords}
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--ff-text-secondary)]">Matches:</span>{' '}
                    <span className="text-green-400">{uploadResult.stats.matchCount}</span>
                  </div>
                  <div>
                    <span className="text-[var(--ff-text-secondary)]">Mismatches:</span>{' '}
                    <span className="text-amber-400">{uploadResult.stats.mismatchCount}</span>
                  </div>
                  <div>
                    <span className="text-[var(--ff-text-secondary)]">Empty:</span>{' '}
                    <span className="text-[var(--ff-text-tertiary)]">
                      {uploadResult.stats.emptySerialCount}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
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
                  {records.map((record) => (
                    <tr
                      key={record.id}
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
                      <td className="py-3 px-4 text-red-400 font-mono">
                        {record.wrong_onemap_serial || record.onemap_serial || '-'}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            record.fix_status === 'fixed'
                              ? 'bg-green-500/20 text-green-400'
                              : record.fix_status === 'escalated'
                              ? 'bg-red-500/20 text-red-400'
                              : 'bg-amber-500/20 text-amber-400'
                          }`}
                        >
                          {record.fix_status || 'pending'}
                        </span>
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
                              Fix
                            </button>
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
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-accent)]" />
            </div>
          ) : imports.length === 0 ? (
            <div className="text-center py-12 text-[var(--ff-text-tertiary)]">
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
            >
              {exporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              Export CSV
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
