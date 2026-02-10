'use client';

import React, { useState, useCallback, useEffect } from 'react';
import {
  Search, Map, RefreshCw, Loader2, AlertCircle, XCircle, Download,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface PPRecord {
  id: number;
  serial_number: string;
  project: string;
  date_registered: string | null;
  resolution_status: string;
  resolved_drop_number: string | null;
  resolved_source: string | null;
  resolved_at: string | null;
}

interface PPStats {
  total: number;
  activated: number;
  located: number;
  notFound: number;
  projects: number;
  lastImport: {
    date: string;
    filename: string;
    totalRows: number;
  } | null;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  not_found: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-800 dark:text-amber-300', label: 'Not Found' },
  located_oes: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-300', label: 'Found (OES)' },
  located_unified: { bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-800 dark:text-indigo-300', label: 'Found (Unified)' },
  located_onemap: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-800 dark:text-purple-300', label: 'Found (OneMap)' },
  located_1map: { bg: 'bg-teal-100 dark:bg-teal-900/30', text: 'text-teal-800 dark:text-teal-300', label: 'Found (1Map)' },
  activated: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-300', label: 'Activated' },
};

export function PPDataTab() {
  const [isScanning, setIsScanning] = useState(false);
  const [isLooking1Map, setIsLooking1Map] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<PPStats | null>(null);
  const [records, setRecords] = useState<PPRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filterProject, setFilterProject] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

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

      const res = await fetch(`/api/activate/import-pp-data?${params}`);
      const data = await res.json();
      if (data.success) {
        setRecords(data.data);
        setTotalPages(data.pagination.totalPages);
      }
    } catch {
      // Non-fatal
    }
  }, [page, filterProject, filterStatus]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { if (stats && stats.total > 0) fetchRecords(); }, [stats, fetchRecords]);

  const handleLocalScan = async () => {
    setIsScanning(true);
    setError(null);
    try {
      const res = await fetch('/api/activate/pp-data-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'local-scan' }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Scan failed');
      toast.success(`Local scan: ${result.data.total_resolved} new matches found`);
      fetchStats();
      fetchRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setIsScanning(false);
    }
  };

  const handle1MapLookup = async () => {
    setIsLooking1Map(true);
    setError(null);
    try {
      const res = await fetch('/api/activate/pp-data-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: '1map-lookup' }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || '1Map lookup failed');
      toast.success(result.data.message || `1Map lookup: ${result.data.total_resolved} matches found`);
      fetchStats();
      fetchRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : '1Map lookup failed');
    } finally {
      setIsLooking1Map(false);
    }
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
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
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
            <p className="text-sm text-[var(--ff-text-secondary)]">Last Import</p>
            <p className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
              {stats.lastImport
                ? new Date(stats.lastImport.date).toLocaleDateString()
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

      {/* Action Buttons */}
      {stats && stats.total > 0 && (
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleLocalScan}
            disabled={isScanning}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700
                       disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isScanning ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Scanning...</>
            ) : (
              <><Search className="w-4 h-4" /> Scan Local Data</>
            )}
          </button>
          <button
            onClick={handle1MapLookup}
            disabled={isLooking1Map}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700
                       disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLooking1Map ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Looking up...</>
            ) : (
              <><Map className="w-4 h-4" /> 1Map Bulk Lookup</>
            )}
          </button>
          <button
            onClick={() => { fetchStats(); fetchRecords(); }}
            className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]
                       border border-[var(--ff-border-light)] rounded-lg flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
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
              <option value="activated">Activated</option>
            </select>
            <div className="ml-auto">
              <button
                onClick={() => {
                  const params = new URLSearchParams({ action: 'export' });
                  if (filterProject) params.set('project', filterProject);
                  if (filterStatus) params.set('status', filterStatus);
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
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Serial</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Project</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Registered</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Status</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">DR</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Source</th>
                  <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Found At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {records.map((record) => {
                  const statusStyle = STATUS_COLORS[record.resolution_status] || { bg: 'bg-gray-100 dark:bg-gray-900/30', text: 'text-gray-800 dark:text-gray-300', label: record.resolution_status };
                  return (
                    <tr key={record.id} className="bg-[var(--ff-bg-secondary)]">
                      <td className="px-3 py-2 font-mono text-[var(--ff-text-primary)]">{record.serial_number}</td>
                      <td className="px-3 py-2 text-[var(--ff-text-secondary)]">{record.project}</td>
                      <td className="px-3 py-2 text-[var(--ff-text-secondary)]">
                        {record.date_registered ? new Date(record.date_registered).toLocaleDateString() : '-'}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                          {statusStyle.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[var(--ff-text-primary)]">
                        {record.resolved_drop_number || '-'}
                      </td>
                      <td className="px-3 py-2 text-[var(--ff-text-secondary)]">
                        {record.resolved_source || '-'}
                      </td>
                      <td className="px-3 py-2 text-[var(--ff-text-secondary)]">
                        {record.resolved_at ? new Date(record.resolved_at).toLocaleString() : '-'}
                      </td>
                    </tr>
                  );
                })}
                {records.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-[var(--ff-text-tertiary)]">
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
    </div>
  );
}
