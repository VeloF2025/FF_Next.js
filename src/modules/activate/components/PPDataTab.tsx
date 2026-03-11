'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Search, RefreshCw, Loader2, AlertCircle, XCircle, Download, CheckCircle2, Wrench,
} from 'lucide-react';
import { formatDisplayDate } from '@/utils/dateFormat';
import toast from 'react-hot-toast';
import { CreatePPTicketsModal } from './CreatePPTicketsModal';

interface PPRecord {
  id: number;
  serial_number: string;
  project: string;
  date_registered: string | null;
  resolution_status: string;
  resolved_drop_number: string | null;
  resolved_source: string | null;
  resolved_at: string | null;
  maintenance_ticket_id: string | null;
  ticket_uid: string | null;
  oes_team: string | null;
  activation_date: string | null;
  wa_phone: string | null;
  wa_name: string | null;
  wa_team: string | null;
}

interface PPStats {
  total: number;
  activated: number;
  located: number;
  notFound: number;
  projects: number;
  ticketed: number;
  lastImport: {
    date: string;
    filename: string;
    totalRows: number;
  } | null;
}

interface LookupStatus {
  status: 'running' | 'success' | 'failed';
  startedAt: string;
  completedAt: string | null;
  total: number;
  searched: number;
  resolved: number;
  not_found: number;
  errors: number;
  elapsed_seconds?: number;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  not_found: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-800 dark:text-amber-300', label: 'Not Found' },
  located_oes: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-300', label: 'Found (OES)' },
  located_unified: { bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-800 dark:text-indigo-300', label: 'Found (Unified)' },
  located_onemap: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-800 dark:text-purple-300', label: 'Found (OneMap)' },
  located_1map: { bg: 'bg-teal-100 dark:bg-teal-900/30', text: 'text-teal-800 dark:text-teal-300', label: 'Found (1Map)' },
  located_local: { bg: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-800 dark:text-cyan-300', label: 'Found (Local)' },
  activated: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-300', label: 'Activated' },
};

/** Check if a record is eligible for ticket selection (located or not_found, no existing ticket) */
function isSelectable(r: PPRecord): boolean {
  return (r.resolved_drop_number !== null || r.resolution_status === 'not_found') && r.maintenance_ticket_id === null;
}

export function PPDataTab() {
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<PPStats | null>(null);
  const [records, setRecords] = useState<PPRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filterProject, setFilterProject] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [lookupStatus, setLookupStatus] = useState<LookupStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Selection & ticket modal state
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [creatingTickets, setCreatingTickets] = useState(false);

  // Clear selection when filters or page change
  useEffect(() => { setSelectedIds([]); }, [page, filterProject, filterStatus, filterDateFrom, filterDateTo]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/activate/import-pp-data?action=stats');
      const data = await res.json();
      if (data.success) setStats(data.data);
    } catch {
      // Non-fatal
    }
  }, []);

  const fetchRecords = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        action: 'list',
        page: String(page),
        limit: '50',
      });
      if (filterProject) params.set('project', filterProject);
      if (filterStatus) params.set('status', filterStatus);
      if (filterDateFrom) params.set('dateFrom', filterDateFrom);
      if (filterDateTo) params.set('dateTo', filterDateTo);

      const res = await fetch(`/api/activate/import-pp-data?${params}`);
      const data = await res.json();
      if (data.success) {
        setRecords(data.data);
        setTotalPages(data.pagination.totalPages);
      }
    } catch {
      // Non-fatal
    }
  }, [page, filterProject, filterStatus, filterDateFrom, filterDateTo]);

  const fetchLookupStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/activate/import-pp-data?action=lookup-status');
      const data = await res.json();
      if (data.success && data.data) {
        setLookupStatus(data.data);
        if (data.data.status === 'running') {
          if (!pollRef.current) {
            pollRef.current = setInterval(() => {
              fetch('/api/activate/import-pp-data?action=lookup-status')
                .then(r => r.json())
                .then(d => {
                  if (d.success && d.data) {
                    setLookupStatus(d.data);
                    if (d.data.status !== 'running' && pollRef.current) {
                      clearInterval(pollRef.current);
                      pollRef.current = null;
                    }
                  }
                })
                .catch(() => { /* non-fatal */ });
            }, 3000);
          }
        } else {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          if (data.data.status === 'success') { fetchStats(); fetchRecords(); }
        }
      }
    } catch { /* non-fatal */ }
  }, [fetchStats, fetchRecords]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { if (stats && stats.total > 0) fetchRecords(); }, [stats, fetchRecords]);

  useEffect(() => {
    fetchLookupStatus();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchLookupStatus]);

  const handleResolveAll = async () => {
    setIsResolving(true);
    setError(null);
    try {
      const res = await fetch('/api/activate/pp-data-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve-all' }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Resolve all failed');
      const d = result.data;
      const parts: string[] = [];
      if (d.steps.local_scan.resolved > 0) parts.push(`Local: ${d.steps.local_scan.resolved}`);
      if (d.steps.wa_cross_ref.resolved > 0) parts.push(`WA cross-ref: ${d.steps.wa_cross_ref.resolved}`);
      if (d.steps.wa_photo_vlm.resolved > 0) parts.push(`VLM photos: ${d.steps.wa_photo_vlm.resolved}`);
      const msg = d.total_resolved > 0
        ? `Resolved ${d.total_resolved} PPs (${parts.join(', ')})`
        : 'No new matches found across all sources';
      toast.success(d.onemap_started ? `${msg} — 1Map search running...` : msg);
      fetchStats();
      fetchRecords();
      // 1Map lookup runs in background — start polling for its progress
      if (d.onemap_started) {
        setTimeout(() => fetchLookupStatus(), 2000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resolve all failed');
    } finally {
      setIsResolving(false);
    }
  };

  const handleCreateTickets = async (params: { ticket_type: string; priority: string; notes: string; assigned_team_id?: string }) => {
    setCreatingTickets(true);
    try {
      const res = await fetch('/api/activate/pp-data-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pp_data_ids: selectedIds, ...params }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error?.message || result.error || 'Failed to create tickets');
      const { created, skipped } = result.data;
      toast.success(`Created ${created} ticket${created !== 1 ? 's' : ''}${skipped > 0 ? ` (${skipped} skipped)` : ''}`);
      setShowTicketModal(false);
      setSelectedIds([]);
      fetchStats();
      fetchRecords();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create tickets');
    } finally {
      setCreatingTickets(false);
    }
  };

  // Select all not_found records across all pages
  const [selectingAllNotFound, setSelectingAllNotFound] = useState(false);
  const handleSelectAllNotFound = async () => {
    setSelectingAllNotFound(true);
    try {
      const params = new URLSearchParams({ action: 'list', status: 'not_found', limit: '10000' });
      const res = await fetch(`/api/activate/import-pp-data?${params}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        const notFoundIds = data.data
          .filter((r: PPRecord) => r.maintenance_ticket_id === null)
          .map((r: PPRecord) => r.id);
        setSelectedIds(notFoundIds);
        // Switch filter to not_found so user can see the selection
        setFilterStatus('not_found');
        setPage(1);
        toast.success(`Selected ${notFoundIds.length} not-found records`);
      }
    } catch {
      toast.error('Failed to fetch not-found records');
    } finally {
      setSelectingAllNotFound(false);
    }
  };

  // Selection helpers
  const selectableOnPage = records.filter(isSelectable);
  const allSelectableChecked = selectableOnPage.length > 0 && selectableOnPage.every(r => selectedIds.includes(r.id));

  const toggleSelectAll = () => {
    if (allSelectableChecked) {
      setSelectedIds(prev => prev.filter(id => !selectableOnPage.some(r => r.id === id)));
    } else {
      setSelectedIds(prev => {
        const newIds = new Set(prev);
        selectableOnPage.forEach(r => newIds.add(r.id));
        return Array.from(newIds);
      });
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };


  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-blue-300">
          PP Data is automatically imported from the <strong>PP DATA</strong> sheet when you import an OES Excel file via the OES tab.
          Use the actions below to locate imported serials against local data or 1Map. Serials are marked <strong>Activated</strong> when they appear in OES activations.
        </p>
      </div>

      {/* Summary Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-4">
          <div className="bg-[var(--ff-bg-primary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
            <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.total}</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">Total Imported</p>
          </div>
          <div className="bg-[var(--ff-bg-primary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
            <p className="text-2xl font-bold text-green-500">{stats.activated}</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">Activated</p>
          </div>
          <div className="bg-[var(--ff-bg-primary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
            <p className="text-2xl font-bold text-blue-500">{stats.located}</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">Located</p>
          </div>
          <div className="bg-[var(--ff-bg-primary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
            <p className="text-2xl font-bold text-amber-500">{stats.notFound}</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">Not Found</p>
          </div>
          <div className="bg-[var(--ff-bg-primary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
            <p className="text-2xl font-bold text-orange-500">{stats.ticketed}</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">Ticketed</p>
          </div>
          <div className="bg-[var(--ff-bg-primary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
            <p className="text-sm text-[var(--ff-text-secondary)]">Last Import</p>
            <p className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
              {stats.lastImport
                ? formatDisplayDate(stats.lastImport.date)
                : 'Never'}
            </p>
          </div>
        </div>
      )}

      {/* No Data State */}
      {stats && stats.total === 0 && (
        <div className="text-center py-12 text-[var(--ff-text-tertiary)]">
          <p className="text-lg mb-2">No PP Data imported yet</p>
          <p className="text-sm">Import an OES Excel file from the OES tab to automatically extract PP Data.</p>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-300">Error</p>
            <p className="text-sm text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* 1Map Lookup Progress */}
      {lookupStatus && lookupStatus.status === 'running' && lookupStatus.total > 0 && (
        <div className="bg-purple-900/20 border border-purple-800 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
            <span className="text-sm font-medium text-purple-300">
              1Map Serial Search in Progress
            </span>
            <span className="text-xs text-purple-400 ml-auto">
              {lookupStatus.elapsed_seconds ? `${lookupStatus.elapsed_seconds}s elapsed` : ''}
            </span>
          </div>
          <div className="w-full bg-purple-900/40 rounded-full h-2">
            <div
              className="bg-purple-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${Math.round((lookupStatus.searched / lookupStatus.total) * 100)}%` }}
            />
          </div>
          <div className="flex gap-6 text-xs text-purple-300">
            <span>Searched: <strong>{lookupStatus.searched}</strong> / {lookupStatus.total}</span>
            <span className="text-teal-400">Found: <strong>{lookupStatus.resolved}</strong></span>
            <span className="text-amber-400">Not Found: <strong>{lookupStatus.not_found}</strong></span>
            {lookupStatus.errors > 0 && (
              <span className="text-red-400">Errors: <strong>{lookupStatus.errors}</strong></span>
            )}
          </div>
        </div>
      )}

      {/* 1Map Lookup Complete Banner */}
      {lookupStatus && lookupStatus.status === 'success' && lookupStatus.total > 0 && (
        <div className="bg-green-900/20 border border-green-800 rounded-lg p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
          <div className="text-sm text-green-300">
            <strong>1Map search complete.</strong>{' '}
            Searched {lookupStatus.total} serials — found <strong>{lookupStatus.resolved}</strong>,
            not found {lookupStatus.not_found}
            {lookupStatus.elapsed_seconds ? ` in ${lookupStatus.elapsed_seconds}s` : ''}.
          </div>
          <button
            onClick={() => setLookupStatus(null)}
            className="ml-auto text-green-500 hover:text-green-300"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Action Buttons */}
      {stats && stats.total > 0 && (
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleResolveAll}
            disabled={isResolving || lookupStatus?.status === 'running'}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700
                       disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isResolving ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Resolving...</>
            ) : lookupStatus?.status === 'running' ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> 1Map Searching...</>
            ) : (
              <><Search className="w-4 h-4" /> Resolve All</>
            )}
          </button>
          {stats && stats.notFound > 0 && (
            <button
              onClick={handleSelectAllNotFound}
              disabled={selectingAllNotFound}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700
                         disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {selectingAllNotFound ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Loading...</>
              ) : (
                <><Wrench className="w-4 h-4" /> Ticket All Not Found ({stats.notFound})</>
              )}
            </button>
          )}
          <button
            onClick={() => { fetchStats(); fetchRecords(); }}
            className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]
                       border border-[var(--ff-border-light)] rounded-lg flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      )}

      {/* Bulk Actions Bar */}
      {selectedIds.length > 0 && (
        <div className="bg-blue-900/30 border border-blue-700 rounded-lg px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-blue-300">
            <strong>{selectedIds.length}</strong> record{selectedIds.length !== 1 ? 's' : ''} selected
          </span>
          <div className="flex gap-3">
            <button
              onClick={() => setSelectedIds([])}
              className="px-3 py-1.5 text-sm rounded border border-blue-700 text-blue-300 hover:text-blue-100"
            >
              Clear
            </button>
            <button
              onClick={() => setShowTicketModal(true)}
              className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700
                         flex items-center gap-1.5"
            >
              <Wrench className="w-3.5 h-3.5" /> Create NOC Tickets
            </button>
          </div>
        </div>
      )}

      {/* Filters & Records Table */}
      {stats && stats.total > 0 && (
        <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
          <div className="bg-[var(--ff-bg-primary)] px-4 py-3 border-b border-[var(--ff-border-light)] flex flex-wrap gap-3 items-center">
            <select
              value={filterProject}
              onChange={(e) => { setFilterProject(e.target.value); setPage(1); }}
              className="px-3 py-1.5 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]
                         text-[var(--ff-text-primary)] text-sm"
            >
              <option value="">All Projects</option>
              <option value="Lawley">Lawley</option>
              <option value="Mohadin">Mohadin</option>
              <option value="Mamelodi">Mamelodi</option>
            </select>
            <select
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
              className="px-3 py-1.5 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]
                         text-[var(--ff-text-primary)] text-sm"
            >
              <option value="">All Statuses</option>
              <option value="not_found">Not Found</option>
              <option value="located_oes">Found (OES)</option>
              <option value="located_unified">Found (Unified)</option>
              <option value="located_onemap">Found (OneMap)</option>
              <option value="located_1map">Found (1Map)</option>
              <option value="located_local">Found (Local)</option>
              <option value="activated">Activated</option>
            </select>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--ff-text-tertiary)]">From</label>
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }}
                className="px-2 py-1.5 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]
                           text-[var(--ff-text-primary)] text-sm"
              />
              <label className="text-xs text-[var(--ff-text-tertiary)]">To</label>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => { setFilterDateTo(e.target.value); setPage(1); }}
                className="px-2 py-1.5 rounded bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]
                           text-[var(--ff-text-primary)] text-sm"
              />
              {(filterDateFrom || filterDateTo) && (
                <button
                  onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); setPage(1); }}
                  className="p-1 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]"
                  title="Clear dates"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="ml-auto">
              <button
                onClick={() => {
                  const params = new URLSearchParams({ action: 'export' });
                  if (filterProject) params.set('project', filterProject);
                  if (filterStatus) params.set('status', filterStatus);
                  if (filterDateFrom) params.set('dateFrom', filterDateFrom);
                  if (filterDateTo) params.set('dateTo', filterDateTo);
                  window.open(`/api/activate/import-pp-data?${params}`, '_blank');
                }}
                className="px-3 py-1.5 text-sm rounded border border-[var(--ff-border-light)]
                           text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]
                           flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Export Excel
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--ff-bg-tertiary)]">
                <tr>
                  <th className="px-3 py-2 w-10">
                    {selectableOnPage.length > 0 && (
                      <input
                        type="checkbox"
                        checked={allSelectableChecked}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-600"
                      />
                    )}
                  </th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Serial</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Project</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Registered</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Status</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">DR</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Install Team</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Activation</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">WA Technician</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Source</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Ticket</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {records.map((record) => {
                  const statusStyle = STATUS_COLORS[record.resolution_status] || { bg: 'bg-background/30', text: 'text-foreground', label: record.resolution_status };
                  const selectable = isSelectable(record);
                  return (
                    <tr key={record.id} className={`bg-[var(--ff-bg-secondary)] ${selectedIds.includes(record.id) ? 'bg-blue-900/10' : ''}`}>
                      <td className="px-3 py-2">
                        {selectable ? (
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(record.id)}
                            onChange={() => toggleSelect(record.id)}
                            className="rounded border-gray-600"
                          />
                        ) : null}
                      </td>
                      <td className="px-3 py-2 font-mono text-[var(--ff-text-primary)]">{record.serial_number}</td>
                      <td className="px-3 py-2 text-[var(--ff-text-secondary)]">{record.project}</td>
                      <td className="px-3 py-2 text-[var(--ff-text-secondary)]">
                        {record.date_registered ? formatDisplayDate(record.date_registered) : '-'}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                          {statusStyle.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[var(--ff-text-primary)]">
                        {record.resolved_drop_number || '-'}
                      </td>
                      <td className="px-3 py-2 text-[var(--ff-text-secondary)] text-xs">
                        {record.oes_team || '-'}
                      </td>
                      <td className="px-3 py-2 text-[var(--ff-text-secondary)] text-xs">
                        {record.activation_date ? formatDisplayDate(record.activation_date) : '-'}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {record.wa_name ? (
                          <div>
                            <span className="text-[var(--ff-text-primary)]">{record.wa_name}</span>
                            {record.wa_phone && (
                              <span className="block text-[var(--ff-text-tertiary)] font-mono text-[10px]">{record.wa_phone}</span>
                            )}
                          </div>
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2 text-[var(--ff-text-secondary)]">
                        {record.resolved_source || '-'}
                      </td>
                      <td className="px-3 py-2">
                        {record.ticket_uid ? (
                          <a
                            href={`/noc/tickets/${record.maintenance_ticket_id}`}
                            className="text-blue-400 hover:text-blue-300 text-xs font-mono"
                          >
                            {record.ticket_uid}
                          </a>
                        ) : (
                          <span className="text-[var(--ff-text-tertiary)]">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {records.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-8 text-center text-[var(--ff-text-tertiary)]">
                      No records found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-between items-center px-4 py-3 border-t border-[var(--ff-border-light)]">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-sm rounded border border-[var(--ff-border-light)]
                           text-[var(--ff-text-secondary)] disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm text-[var(--ff-text-secondary)]">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 text-sm rounded border border-[var(--ff-border-light)]
                           text-[var(--ff-text-secondary)] disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* Create Tickets Modal */}
      {showTicketModal && (
        <CreatePPTicketsModal
          selectedCount={selectedIds.length}
          onConfirm={handleCreateTickets}
          onClose={() => setShowTicketModal(false)}
          loading={creatingTickets}
        />
      )}
    </div>
  );
}
